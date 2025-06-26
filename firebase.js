
import admin from 'firebase-admin';
import serviceAccount from './firebase-service-account.json' with { type: "json" };

// Initialize Firebase Admin with the service account if not already initialized
const appName = 'imageboost-seo';

let app;
let db;
let bucket;

try {
  // Get the existing app
  app = admin.app(appName);
  db = admin.firestore(app);
  const bucketName = 'imageboost-seo.firebasestorage.app';
  console.log('Using existing Firebase app with storage bucket:', bucketName);
  bucket = admin.storage(app).bucket(bucketName);
  console.log('Bucket URL:', `gs://${bucketName}`);
} catch (error) {
  // If the app doesn't exist, initialize it
  if (error.code === 'app/no-app') {
    console.log('Initializing Firebase app...');
    try {
      // Initialize with the specified storage bucket
      const bucketName = 'imageboost-seo.firebasestorage.app';
      console.log('Initializing Firebase with storage bucket:', bucketName);
      
      app = admin.initializeApp(
        {
          credential: admin.credential.cert(serviceAccount),
          storageBucket: bucketName
        },
        appName
      );
      
      db = admin.firestore(app);
      bucket = admin.storage(app).bucket(bucketName);
      console.log('Firebase initialized successfully');
      console.log('Bucket URL:', `gs://${bucketName}`);
    } catch (initError) {
      console.error('Error initializing Firebase:', initError);
      throw initError;
    }
  } else {
    // Re-throw other errors
    throw error;
  }
}

// Ensure undefined values are ignored in documents (avoids validation errors)
if (db) {
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (settingsErr) {
    console.warn('[Firebase] Could not set ignoreUndefinedProperties:', settingsErr.message);
  }
}

export { db, bucket };
export default { db, bucket };
