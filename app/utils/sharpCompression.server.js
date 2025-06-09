import sharp from 'sharp';
import fetch from 'node-fetch';

export async function* compressMultipleImages(imageUrls, options = {}) {
  console.log('[Sharp] Starting compression for', imageUrls.length, 'images');
  console.log('[Sharp] Compression options:', options);
  
  const {
    quality = 80,
    maxWidth = 1200,
    maxHeight = 1200,
  } = options;

  for (const url of imageUrls) {
    let result;
    try {
      console.log(`[Sharp] Processing image: ${url}`);
      
      // Fetch the image
      console.log(`[Sharp] Fetching image from: ${url}`);
      let response;
      try {
        response = await fetch(url);
        if (!response.ok) {
          const errorMsg = `Failed to fetch image: ${response.status} ${response.statusText}`;
          console.error(`[Sharp] ${errorMsg}`);
          throw new Error(errorMsg);
        }
      } catch (fetchError) {
        console.error('[Sharp] Error fetching image:', fetchError);
        throw new Error(`Failed to fetch image: ${fetchError.message}`);
      }
      console.log('[Sharp] Successfully fetched image');
      
      const buffer = await response.arrayBuffer();
      const originalSize = buffer.byteLength;
      console.log(`[Sharp] Original image size: ${originalSize} bytes`);
      
      // Process with Sharp
      console.log('[Sharp] Initializing Sharp processor');
      let sharpInstance = sharp(Buffer.from(buffer));
      
      // Get image metadata
      console.log('[Sharp] Getting image metadata');
      const metadata = await sharpInstance.metadata();
      console.log('[Sharp] Image metadata:', {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        size: metadata.size,
        hasAlpha: metadata.hasAlpha,
        hasProfile: metadata.hasProfile,
        space: metadata.space,
      });
      
      // Resize if needed
      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        console.log(`[Sharp] Resizing image from ${metadata.width}x${metadata.height} to max ${maxWidth}x${maxHeight}`);
        sharpInstance = sharpInstance.resize({
          width: maxWidth,
          height: maxHeight,
          fit: 'inside',
          withoutEnlargement: true
        });
      } else {
        console.log('[Sharp] No resizing needed');
      }
      
      // Convert to WebP format with specified quality
      console.log(`[Sharp] Converting to WebP with quality: ${quality}`);
      try {
        const compressedBuffer = await sharpInstance
          .webp({ 
            quality: parseInt(quality, 10),
            force: true,
            effort: 6,  // Higher effort for better compression (1-6)
            alphaQuality: 80,
            lossless: false,
            nearLossless: false,
            smartSubsample: true
          })
          .toBuffer();
        
        const compressedSize = compressedBuffer.byteLength;
        const savings = 1 - (compressedSize / originalSize);
        
        console.log(`[Sharp] Compression successful`);
        console.log(`[Sharp] Original size: ${originalSize} bytes`);
        console.log(`[Sharp] Compressed size: ${compressedSize} bytes`);
        console.log(`[Sharp] Savings: ${(savings * 100).toFixed(2)}%`);
        
        result = {
          success: true,
          originalSize,
          compressedSize,
          savings,
          buffer: compressedBuffer,
          format: 'webp',
          strategy: 'sharp'
        };
      } catch (webpError) {
        console.error('[Sharp] WebP conversion failed, trying PNG as fallback:', webpError);
        // Fallback to PNG if WebP fails
        const pngBuffer = await sharpInstance
          .png({ 
            quality: parseInt(quality, 10),
            compressionLevel: 9,  // Maximum compression
            adaptiveFiltering: true,
            force: true
          })
          .toBuffer();
          
        const compressedSize = pngBuffer.byteLength;
        const savings = 1 - (compressedSize / originalSize);
        
        console.log(`[Sharp] PNG fallback successful`);
        console.log(`[Sharp] PNG size: ${compressedSize} bytes`);
        console.log(`[Sharp] Savings: ${(savings * 100).toFixed(2)}%`);
        
        result = {
          success: true,
          originalSize,
          compressedSize,
          savings,
          buffer: pngBuffer,
          format: 'png',
          strategy: 'sharp',
          warning: 'Used PNG fallback: ' + (webpError.message || 'Unknown WebP error')
        };
      }
      
    } catch (error) {
      console.error('[Sharp] Error during compression:', error);
      result = {
        success: false,
        error: error.message,
        url,
        strategy: 'sharp',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
    
    console.log('[Sharp] Yielding result for:', url, {
      success: result.success,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      format: result.format,
      error: result.error
    });
    
    yield [result];
  }
}
