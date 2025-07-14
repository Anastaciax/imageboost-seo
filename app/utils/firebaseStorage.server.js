import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { db, bucket } from '../../firebase.js';
export const canonical = url => (url ? url.split('?')[0] : url);

/**
 * Stores a compressed image in Firebase Storage and saves its metadata to Firestore
 * @param {Buffer} imageBuffer - The compressed image buffer
 * @param {string} originalUrl - The original image URL
 * @param {Object} metadata - Additional metadata about the image
 * @returns {Promise<Object>} - The public URL and metadata of the stored image
 */
export async function storeCompressedImage(imageBuffer, originalUrl, metadata = {}) {
  try {
    console.log('Starting to store compressed image...');
    console.log('Original URL:', originalUrl);
    console.log('Image buffer type:', typeof imageBuffer);
    console.log('Image buffer size:', imageBuffer?.length || 'undefined');

    if (!Buffer.isBuffer(imageBuffer)) {
      throw new Error(`Expected a Buffer, got ${typeof imageBuffer}`);
    }

    if (!imageBuffer.length) {
      throw new Error('Image buffer is empty');
    }

    // Get format from metadata or default to webp
    const format = (metadata.format || 'webp').toLowerCase();
    console.log('[Storage] Received format from metadata:', format);
    console.log('[Storage] Full metadata:', JSON.stringify(metadata, null, 2));

    // Normalize format for content type (jpeg → jpg, etc.)
    const normalizedFormat = format === 'jpeg' ? 'jpg' : format;
    console.log('[Storage] Normalized format:', normalizedFormat);

    // Get correct content type for the format
    const contentType = `image/${format === 'jpg' ? 'jpeg' : format}`;
    console.log('[Storage] Content-Type:', contentType);

    const fileName = `compressed/${uuidv4()}.${normalizedFormat}`;
    const file = bucket.file(fileName);

    console.log('[Storage] Generated filename:', fileName);
    console.log('[Storage] Full file path:', file.name);
    console.log('[Storage] Storage bucket:', bucket.name);
    console.log('Content-Type:', contentType);

    // Upload the file to Firebase Storage (using token so Firebase console can preview/download)
    console.log('Uploading to Firebase Storage...');
    const downloadToken = uuidv4(); // Firebase console relies on this token
    try {
      await file.save(imageBuffer, {
        metadata: {
          contentType: contentType,
          metadata: {
            firebaseStorageDownloadTokens: downloadToken, // make available in console
            originalUrl,
            format: normalizedFormat, // Store normalized format in metadata
            ...metadata,
            storedAt: new Date().toISOString(),
            size: imageBuffer.length
          }
        },
        validation: false // do not make public; token grants access
      });
      console.log('File saved to storage');

      // Build token-based download URL that works in Firebase console
      const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;
      console.log('Download URL:', publicUrl);

      // Save metadata to Firestore
      console.log('[Storage] Saving metadata to Firestore...');
      // Helper to recursively strip undefined values
      const stripUndefined = (input) => {
        if (Array.isArray(input)) return input.map(stripUndefined);
        if (input && typeof input === 'object') {
          return Object.entries(input).reduce((acc,[k,v])=>{
            if (v !== undefined) acc[k]=stripUndefined(v);
            return acc;
          },{});
        }
        return input;
      };

      const cleanedMetadata = stripUndefined(metadata);
      const docData = {
        originalUrl: canonical(originalUrl),
        compressedUrl: publicUrl,
        size: imageBuffer.length,
        format: normalizedFormat, // Use the normalized format
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ...cleanedMetadata,
        _storageMetadata: {
          normalizedFormat,
          originalFormat: metadata?.format ?? null,
          detectedContentType: contentType,
          storagePath: fileName,
          downloadToken
        }
      };
      console.log('[Storage] Document data to be saved:', JSON.stringify(docData, null, 2));
      console.log('Document data:', JSON.stringify(docData, null, 2));

      const docRef = await db.collection('compressedImages').add(docData);
      console.log('Document written with ID: ', docRef.id);

      return {
        id: docRef.id,
        url: publicUrl,
        ...cleanedMetadata
      };
    } catch (storageError) {
      console.error('Storage error details:', {
        name: storageError.name,
        message: storageError.message,
        code: storageError.code,
        stack: storageError.stack
      });
      throw storageError;
    }
  } catch (error) {
    console.error('Error in storeCompressedImage:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack
    });
    throw new Error(`Failed to store compressed image: ${error.message}`);
  }
}

/**
 * Checks if an image has already been compressed and stored
 * @param {string} originalUrl - The original image URL to check
 * @returns {Promise<Object|null>} - The stored image metadata if found, null otherwise
 */
export async function findStoredImage(originalUrl, imageId = null) {
  // Ensure consistent matching with stored documents (which save canonical URLs)
  const canonicalUrl = canonical(originalUrl);

  try {
   if (imageId) {
       const byId = await db.collection('compressedImages')
                            .where('shopifyImageId', '==', imageId)
                            .limit(1).get();
       if (!byId.empty) {
         const doc = byId.docs[0];
         return { id: doc.id, ...doc.data() };
       }
     }
    const snapshot = await db.collection('compressedImages')
      .where('originalUrl', '==', canonicalUrl)
      .limit(1)
      .get();

    let doc;
    if (snapshot.empty) {
      const byShopifyUrl = await db.collection('compressedImages')
      .where('shopifyCompressedUrl', '==', canonicalUrl)
      .limit(1).get();
  if (!byShopifyUrl.empty) {
    const doc = byShopifyUrl.docs[0];
    return { id: doc.id, ...doc.data() };
  }
      // Fallback: maybe caller passed the COMPRESSED url (current product image)
      const fallback = await db.collection('compressedImages')
      .where('compressedUrl', '==', canonicalUrl)
      .limit(1)
      .get();

      if (fallback.empty) {
        return null;
      }
      doc = fallback.docs[0];
    } else {
      doc = snapshot.docs[0];
    }

    const data = doc.data();



    // Determine the storage object path to verify existence.
    let storagePath = data?._storageMetadata?.storagePath;

    // If not recorded, attempt to derive it from the download URL
    if (!storagePath && data.compressedUrl) {
      try {
        const url = new URL(data.compressedUrl);
        const derived = decodeURIComponent(url.pathname.split('/o/')[1] || '').split('?')[0];
        if (derived) {
          storagePath = derived;
          // Persist the derived path for next time so we don’t repeat this work
          await doc.ref.set({
            _storageMetadata: {
              ...(data._storageMetadata || {}),
              storagePath: derived
            }
          }, { merge: true });
          console.log('[findStoredImage] Back-filled missing storagePath for', doc.id);
        }
      } catch (err) {
        console.warn('[findStoredImage] Failed to derive storagePath from URL:', err.message);
      }
    }

    // If still unavailable, treat document as stale
    if (!storagePath) {
      console.warn('[findStoredImage] Could not resolve storage path after fallback, deleting stale doc.');
      await doc.ref.delete();
      return null;
    }

    try {
      const [exists] = await bucket.file(storagePath).exists();
      if (!exists) {
        console.warn('[findStoredImage] Stored image missing from bucket, deleting stale doc:', storagePath);
        await doc.ref.delete();
        return null;
      }
    } catch (checkErr) {
      console.error('[findStoredImage] Error checking object existence:', checkErr);
      await doc.ref.delete();
      return null;
    }

    return {
      id: doc.id,
      url: data.compressedUrl,
      ...data
    };
  } catch (error) {
    console.error('Error finding stored image:', error);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Original image helpers
// -----------------------------------------------------------------------------
/**
 * Stores an ORIGINAL (uncompressed) image buffer in Firebase Storage so that we
 * can later revert a Shopify replacement. Very similar to storeCompressedImage
 * but files live under the `original/` folder and get written to their own
 * Firestore collection (`originalImages`).
 */
export async function storeOriginalImage(imageBuffer, originalUrl, metadata = {}) {
  try {
    if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) {
      throw new Error('Invalid or empty image buffer provided to storeOriginalImage');
    }

    // Infer format (jpeg/png/webp/gif) from metadata or originalUrl as best we can
    let format = (metadata.format || '').toLowerCase();
    if (!format) {
      const ext = (new URL(originalUrl)).pathname.split('.').pop().toLowerCase();
      format = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'jpg';
    }

    const normalizedFormat = format === 'jpeg' ? 'jpg' : format;
    const contentType = `image/${normalizedFormat === 'jpg' ? 'jpeg' : normalizedFormat}`;

    const fileName = `original/${uuidv4()}.${normalizedFormat}`;
    const file = bucket.file(fileName);
    const downloadToken = uuidv4();

    await file.save(imageBuffer, {
      metadata: {
        contentType,
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          originalUrl,
          format: normalizedFormat,
          storedAt: new Date().toISOString(),
          size: imageBuffer.length,
          ...metadata
        }
      },
      validation: false
    });

    const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${downloadToken}`;

    const docRef = await db.collection('originalImages').add({
      originalUrl,
      storedUrl: publicUrl,
      size: imageBuffer.length,
      format: normalizedFormat,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ...metadata,
      _storageMetadata: {
        storagePath: fileName,
        downloadToken,
        contentType
      }
    });

    return {
      id: docRef.id,
      url: publicUrl,
      size: imageBuffer.length,
      format: normalizedFormat
    };
  } catch (err) {
    console.error('[storeOriginalImage] Error:', err);
    throw err;
  }
}

/**
 * Retrieve stored ORIGINAL image metadata, if any.
 */
export async function findOriginalImage(originalUrl) {
  try {
    const snapshot = await db.collection('originalImages')
      .where('originalUrl', '==', canonical(originalUrl))
      .limit(1)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    const data = doc.data();
    return { id: doc.id, ...data };
  } catch (err) {
    console.error('[findOriginalImage] Error:', err);
    return null;
  }
}

export default {
  storeCompressedImage,
  findStoredImage,
  storeOriginalImage,
  findOriginalImage
};
