import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import { compressMultipleImages as tinifyCompress } from '../utils/imageCompression.server';
import { compressMultipleImages as sharpCompress } from '../utils/sharpCompression.server';

export async function action({ request }) {
  console.log('=== Compression Request Received ===');
  console.log('Request URL:', request.url);
  console.log('Request Method:', request.method);
  console.log('Request Headers:', Object.fromEntries(request.headers.entries()));
  
  try {
    // Authenticate the request
    await authenticate.admin(request);
    
    const formData = await request.formData();
    const strategy = formData.get('strategy') || 'tinify';
    const imageUrls = formData.getAll('urls').filter(url => url);
    
    console.log('Processing request with strategy:', strategy);
    console.log('Image URLs to process:', imageUrls);
    console.log('FormData entries:');
    for (const [key, value] of formData.entries()) {
      console.log(`  ${key}:`, value);
    }
    
    console.log(`Compression strategy: ${strategy}`);
    console.log('Image URLs to process:', imageUrls);
    
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      console.error('No valid image URLs provided');
      return json({ 
        type: 'error',
        error: 'No image URLs provided' 
      }, { status: 400 });
    }
    
    // Check if Tinify API key is set when using Tinify
    if (strategy === 'tinify' && !process.env.TINIFY_API_KEY) {
      console.error('Tinify API key is not set');
      return json({ 
        type: 'error',
        error: 'Server configuration error: Tinify API key is not set' 
      }, { status: 500 });
    }

    // Process all images with the selected strategy
    const results = [];
    const compressionOptions = {
      quality: 40,  // Lower quality for higher compression (1-100)
      maxWidth: 1200,  // Optional: limit width
      maxHeight: 1200  // Optional: limit height
    };
    
    // Use the appropriate compression function based on strategy
    console.log(`Using compression function: ${strategy === 'sharp' ? 'Sharp' : 'Tinify'}`);
    const compressFunction = strategy === 'sharp' ? sharpCompress : tinifyCompress;
    
    if (strategy === 'sharp') {
      console.log('Sharp module available:', typeof sharpCompress === 'function');
    } else {
      console.log('Tinify module available:', typeof tinifyCompress === 'function');
      console.log('Tinify API key set:', !!process.env.TINIFY_API_KEY);
    }
    
    // Process images one by one to show progress
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      try {
        console.log(`\n--- Processing image ${i + 1}/${imageUrls.length}: ${url} ---`);
        const compressionResult = await compressFunction([url], compressionOptions).next();
        console.log('Compression iteration result:', {
          done: compressionResult.done,
          hasValue: !!compressionResult.value
        });
        
        const result = compressionResult.value?.[0];
        if (result) {
          console.log('Compression successful:', {
            success: result.success,
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            format: result.format,
            error: result.error
          });
          results.push(result);
        } else {
          console.warn('No result returned from compression function');
        }
        
        // Log progress
        const progress = Math.round(((i + 1) / imageUrls.length) * 100);
        console.log(`Progress: ${progress}% - Processed ${i + 1} of ${imageUrls.length} images`);
        
      } catch (error) {
        console.error(`Error processing image ${url} with ${strategy}:`, error);
        results.push({
          url,
          success: false,
          error: error.message,
          strategy
        });
      }
    }

    // Calculate total savings
    const successful = results.filter(r => r.success);
    const totalOriginalSize = successful.reduce((sum, r) => sum + (r.originalSize || 0), 0);
    const totalCompressedSize = successful.reduce((sum, r) => sum + (r.compressedSize || 0), 0);
    const totalSavings = totalOriginalSize > 0 ? (1 - (totalCompressedSize / totalOriginalSize)) * 100 : 0;

    // Return complete response
    return json({
      type: 'complete',
      results,
      totalProcessed: results.length,
      totalSuccessful: successful.length,
      totalErrors: results.length - successful.length,
      strategyUsed: strategy,
      totalOriginalSize,
      totalCompressedSize,
      totalSavings: parseFloat(totalSavings.toFixed(2))
    });
  } catch (error) {
    console.error('Error in compression API:', error);
    return json({
      type: 'error',
      error: error.message || 'An error occurred during compression',
      strategy: 'unknown'
    }, { status: 500 });
  }
}
