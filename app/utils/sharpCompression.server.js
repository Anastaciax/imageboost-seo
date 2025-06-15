import sharp from 'sharp';
import fetch from 'node-fetch';

export async function* compressMultipleImages(imageUrls, options = {}) {
  const {
    quality = 80,
    maxWidth = 1200,
    maxHeight = 1200,
  } = options;

  for (const url of imageUrls) {
    let result;
    try {
      let response;
      try {
        response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
      } catch (fetchError) {
        throw new Error(`Failed to fetch image: ${fetchError.message}`);
      }
      
      const buffer = await response.arrayBuffer();
      const originalSize = buffer.byteLength;
      let sharpInstance = sharp(Buffer.from(buffer));
      
      const metadata = await sharpInstance.metadata();
      
      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        sharpInstance = sharpInstance.resize({
          width: maxWidth,
          height: maxHeight,
          fit: 'inside',
          withoutEnlargement: true
        });
      }
      
      try {
        let compressedBuffer;
        
        if (['jpeg', 'jpg', 'png', 'webp', 'avif', 'tiff', 'gif'].includes(metadata.format)) {
          compressedBuffer = await sharpInstance
            .toFormat(metadata.format, {
              quality: parseInt(quality, 10),
              effort: 6,
              ...(metadata.format === 'jpeg' || metadata.format === 'jpg' ? { mozjpeg: true } : {}),
              ...(metadata.format === 'png' ? { compressionLevel: 9 } : {})
            })
            .toBuffer();
        } else {
          compressedBuffer = await sharpInstance
            .webp({ 
              quality: parseInt(quality, 10),
              effort: 6,
              alphaQuality: 80,
              smartSubsample: true
            })
            .toBuffer();
          metadata.format = 'webp';
        }
        
        const compressedSize = compressedBuffer.byteLength;
        const savings = 1 - (compressedSize / originalSize);
        
        result = {
          success: true,
          originalSize,
          compressedSize,
          savings,
          buffer: compressedBuffer,
          format: metadata.format,
          strategy: 'sharp'
        };
      } catch (webpError) {
        const pngBuffer = await sharpInstance
          .png({ 
            quality: parseInt(quality, 10),
            compressionLevel: 9,
            adaptiveFiltering: true,
            force: true
          })
          .toBuffer();
          
        const compressedSize = pngBuffer.byteLength;
        const savings = 1 - (compressedSize / originalSize);
        
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
      result = {
        success: false,
        error: error.message,
        url,
        strategy: 'sharp',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      };
    }
    
    yield [result];
  }
}
