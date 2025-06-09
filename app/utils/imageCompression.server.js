import tinify from 'tinify';

// Initialize Tinify with API key from environment variables
tinify.key = process.env.TINIFY_API_KEY;

export async function compressImage(imageUrl) {
  console.log(`\n--- Starting compression for: ${imageUrl} ---`);
  try {
    // First, fetch the original image to get its size
    console.log('Fetching original image...');
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    const originalBuffer = await response.arrayBuffer();
    const originalSize = originalBuffer.byteLength;
    console.log(`Original size: ${originalSize} bytes`);

    // Now use tinify to compress
    console.log('Compressing image...');
    const source = tinify.fromBuffer(Buffer.from(originalBuffer));
    const compressedBuffer = await source.toBuffer();
    const compressedSize = compressedBuffer.byteLength;
    console.log(`Compressed size: ${compressedSize} bytes`);

    // Calculate savings
    const savings = (1 - (compressedSize / originalSize)) * 100;
    console.log(`Savings: ${savings.toFixed(2)}%`);

    return {
      success: true,
      originalSize,
      compressedSize,
      savings: savings / 100, // Return as fraction for consistency
      buffer: compressedBuffer
    };
  } catch (error) {
    console.error('Error compressing image:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      ...(error.statusCode && { statusCode: error.statusCode }),
      ...(error.code && { code: error.code })
    });
    return {
      success: false,
      error: error.message
    };
  }
}

export async function* compressMultipleImages(imageUrls) {
  console.log(`\n=== Starting batch compression for ${imageUrls.length} images ===`);
  const results = [];

  for (const [index, url] of imageUrls.entries()) {
    console.log(`\nProcessing image ${index + 1}/${imageUrls.length}`);
    try {
      const result = await compressImage(url);
      console.log('Compression result:', {
        success: result.success,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        savings: result.savings ? `${(result.savings * 100).toFixed(2)}%` : 'N/A'
      });
      const currentResult = {
        url,
        success: result.success,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        savings: result.savings,
        buffer: result.buffer
      };
      results.push(currentResult);

      // Yield the current result for progress tracking
      yield [currentResult];

    } catch (error) {
      console.error(`Error processing image ${url}:`, error);
      const errorResult = {
        url,
        success: false,
        error: error.message
      };
      results.push(errorResult);

      // Yield the error result for error handling
      yield [errorResult];
    }
  }

  return results;
}
