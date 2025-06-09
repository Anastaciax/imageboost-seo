import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import { compressMultipleImages } from '../utils/imageCompression.server';

export async function action({ request }) {
  console.log('Compression request received');
  
  try {
    // Authenticate the request
    await authenticate.admin(request);
    
    const formData = await request.formData();
    const imageUrls = JSON.parse(formData.get('imageUrls') || '[]');
    
    console.log('Image URLs to process:', imageUrls);
    
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      console.error('No valid image URLs provided');
      return json({ error: 'No image URLs provided' }, { status: 400 });
    }
    
    // Check if Tinify API key is set
    if (!process.env.TINIFY_API_KEY) {
      console.error('Tinify API key is not set');
      return json({ error: 'Server configuration error: Tinify API key is not set' }, { status: 500 });
    }

    // Process all images with compression options
    const results = [];
    const compressionOptions = {
      quality: 40,  // Lower quality for higher compression (1-100)
      maxWidth: 1200,  // Optional: limit width
      maxHeight: 1200  // Optional: limit height
    };
    
    for (const url of imageUrls) {
      try {
        const result = (await compressMultipleImages([url], compressionOptions).next()).value?.[0];
        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.error(`Error processing image ${url}:`, error);
        results.push({
          url,
          success: false,
          error: error.message
        });
      }
    }

    // Return complete response
    const successful = results.filter(r => r.success);
    return json({
      type: 'complete',
      results: successful,
      totalProcessed: successful.length,
      totalErrors: results.length - successful.length
    });
    
  } catch (error) {
    console.error('Error in compression endpoint:', error);
    return json({ 
      error: 'Failed to process request',
      message: error.message 
    }, { status: 500 });
  }
}
