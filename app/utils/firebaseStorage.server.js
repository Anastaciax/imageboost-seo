import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { db, bucket } from '../../firebase.js';

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
        originalUrl,
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
export async function findStoredImage(originalUrl) {

  try {
    const snapshot = await db.collection('compressedImages')
      .where('originalUrl', '==', originalUrl)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    // Determine the storage object path to verify existence.
    let storagePath = data?._storageMetadata?.storagePath;
    if (!storagePath && data.compressedUrl) {
      // Fallback: derive from URL
      try {
        const urlParts = new URL(data.compressedUrl);
        const afterBucket = decodeURIComponent(urlParts.pathname.split('/o/')[1] || '');
        storagePath = afterBucket.split('?')[0];
      } catch (_) {
      }
    }

    if (!storagePath) {
      console.warn('[findStoredImage] Could not resolve storage path, treating as missing.');
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

export default {
  storeCompressedImage,
  findStoredImage
};
