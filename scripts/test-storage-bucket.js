import { bucket } from '../firebase.js';

async function testStorageBucket() {
  try {
    console.log('Testing Firebase Storage bucket access...');
    
    // Check if we can list files in the bucket (this will fail if bucket doesn't exist or we don't have permissions)
    const [files] = await bucket.getFiles({
      prefix: 'test/',
      maxResults: 1
    });
    
    console.log('✅ Successfully connected to bucket:', bucket.name);
    console.log(`Bucket URL: gs://${bucket.name}`);
    console.log(`Found ${files.length} files in the 'test/' directory`);
    
    // Try to upload a test file
    const testFileName = `test/test-${Date.now()}.txt`;
    const file = bucket.file(testFileName);
    
    await file.save('This is a test file', {
      metadata: {
        contentType: 'text/plain',
        metadata: {
          test: true,
          timestamp: new Date().toISOString()
        }
      },
      public: true
    });
    
    console.log(`✅ Successfully uploaded test file: ${testFileName}`);
    
    // Get the public URL
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: '03-09-2491'  // Far future date
    });
    
    console.log('Public URL:', url);
    
    // Clean up - delete the test file
    await file.delete();
    console.log('✅ Cleaned up test file');
    
  } catch (error) {
    console.error('❌ Error testing storage bucket:', error);
    
    if (error.code === 404) {
      console.error('The specified bucket does not exist or you do not have access to it.');
      console.error('Please verify the bucket name and ensure your service account has the necessary permissions.');
    } else if (error.code === 401) {
      console.error('Authentication failed. Please check your Firebase service account credentials.');
    } else if (error.code === 403) {
      console.error('Permission denied. Please check your Firebase Storage security rules and IAM permissions.');
    }
    
    process.exit(1);
  }
}

testStorageBucket()
  .then(() => console.log('Test completed successfully'))
  .catch(console.error);
