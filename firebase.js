
import admin from 'firebase-admin';
import serviceAccount from './firebase-service-account.json' with { type: "json" };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

export default db;
