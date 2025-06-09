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
    
    // Generate a unique filename
    const fileExtension = 'webp';
    const fileName = `compressed/${uuidv4()}.${fileExtension}`;
    const file = bucket.file(fileName);
    
    console.log('Generated filename:', fileName);
    console.log('Storage bucket:', bucket.name);

    // Upload the file to Firebase Storage
    console.log('Uploading to Firebase Storage...');
    try {
      await file.save(imageBuffer, {
        metadata: {
          contentType: `image/${fileExtension}`,
          metadata: {
            originalUrl,
            ...metadata,
            storedAt: new Date().toISOString(),
            size: imageBuffer.length
          }
        },
        public: true,
        validation: false
      });
      console.log('File saved to storage, making it public...');

      // Make the file publicly accessible
      await file.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      console.log('File is now public at:', publicUrl);

      // Save metadata to Firestore
      console.log('Saving metadata to Firestore...');
      const docData = {
        originalUrl,
        compressedUrl: publicUrl,
        size: imageBuffer.length,
        format: fileExtension,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ...metadata
      };
      console.log('Document data:', JSON.stringify(docData, null, 2));
      
      const docRef = await db.collection('compressedImages').add(docData);
      console.log('Document written with ID: ', docRef.id);

      return {
        id: docRef.id,
        url: publicUrl,
        ...metadata
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
    return {
      id: doc.id,
      ...doc.data()
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
