import tinify from 'tinify';

// Initialize Tinify with API key from environment variables
tinify.key = process.env.TINIFY_API_KEY;

export async function compressImage(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    
    const originalBuffer = await response.arrayBuffer();
    const originalSize = originalBuffer.byteLength;
    const contentType = response.headers.get('content-type') || '';
    let format = 'webp';
    
    // Determine format from content type
    if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      format = 'jpg';
    } else if (contentType.includes('png')) {
      format = 'png';
    } else if (contentType.includes('webp')) {
      format = 'webp';
    } else if (contentType.includes('gif')) {
      format = 'gif';
    } else {
      // Try to get format from URL as fallback
      const urlObj = new URL(imageUrl);
      const ext = urlObj.pathname.split('.').pop().toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        format = ext === 'jpeg' ? 'jpg' : ext;
      }
    }
    
    const source = tinify.fromBuffer(Buffer.from(originalBuffer));
    let converted;
    
    try {
      switch (format) {
        case 'jpg':
        case 'jpeg':
          converted = source.convert({ type: ['image/jpeg'] });
          break;
        case 'png':
          converted = source.convert({ type: ['image/png'] });
          break;
        case 'webp':
          converted = source.convert({ type: ['image/webp'] });
          break;
        case 'gif':
          converted = source.convert({ type: ['image/gif'] });
          break;
        default:
          converted = source;
      }
    } catch (conversionError) {
      throw new Error(`Format conversion failed: ${conversionError.message}`);
    }
    
    const result = await converted.result();
    const compressedBuffer = await result.toBuffer();
    const compressedSize = compressedBuffer.byteLength;
    const savings = (1 - (compressedSize / originalSize)) * 100;

    return {
      success: true,
      originalSize,
      compressedSize,
      savings: savings / 100,
      buffer: compressedBuffer,
      format: format
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

export async function* compressMultipleImages(imageUrls) {
  const results = [];

  for (const url of imageUrls) {
    try {
      const result = await compressImage(url);
      const normalizedFormat = result.format === 'jpeg' ? 'jpg' : (result.format || 'webp');
      
      const currentResult = {
        url,
        success: result.success,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        savings: result.savings,
        buffer: result.buffer,
        format: normalizedFormat,
        _compressionMetadata: {
          detectedFormat: result.format,
          normalizedFormat: normalizedFormat,
          strategy: 'tinify',
          timestamp: new Date().toISOString()
        }
      };
      
      results.push(currentResult);
      yield [currentResult];

    } catch (error) {
      const errorResult = {
        url,
        success: false,
        error: error.message,
        format: null, // Don't assume webp on error
        _compressionMetadata: {
          error: error.message,
          strategy: 'tinify',
          timestamp: new Date().toISOString()
        }
      };
      
      results.push(errorResult);
      yield [errorResult];
    }
  }

  return results;
}
