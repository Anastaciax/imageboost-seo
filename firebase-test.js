// firebase-test.js
import db from './firebase.js';

async function testWrite() {
  try {
    const res = await db.collection('connection_test').add({
      message: 'Hello from ImageBoost SEO!',
      timestamp: new Date(),
    });

    console.log('✅ Firestore write successful. Doc ID:', res.id);
  } catch (err) {
    console.error('❌ Firestore write failed:', err);
  }
}

testWrite();
