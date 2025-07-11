import sharp from 'sharp';
import fetch from 'node-fetch';

/**
 * Return a quality value (0-100) based on the original file size.
 * Larger images get a higher quality to preserve detail, while
 * smaller images get a lower quality to avoid producing a larger file.
 * Currently: >1 MB → 100, otherwise 80.
 */
function chooseQualityForImage(sizeInBytes) {
  const ONE_MB = 1024 * 1024; // 1 MB
  return sizeInBytes > ONE_MB ? 100 : 80;
}

export async function* compressMultipleImages(imageUrls, options = {}) {
  const {
    quality = 80,
    maxWidth = 1200,
    maxHeight = 1200,
    toWebp = false,
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
      const qualityValue = chooseQualityForImage(originalSize) ?? quality;
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
        let targetFormat = metadata.format;

        if (toWebp && metadata.format !== 'webp') {
          compressedBuffer = await sharpInstance
            .webp({
              quality: parseInt(qualityValue, 10),
              effort: 6,
              alphaQuality: 80,
              smartSubsample: true
            })
            .toBuffer();
          targetFormat = 'webp';
        } else if (['jpeg', 'jpg', 'png', 'webp', 'avif', 'tiff', 'gif'].includes(metadata.format)) {
          compressedBuffer = await sharpInstance
            .toFormat(metadata.format, {
              quality: parseInt(qualityValue, 10),
              effort: 6,
              ...(metadata.format === 'jpeg' || metadata.format === 'jpg' ? { mozjpeg: true } : {}),
              ...(metadata.format === 'png' ? { compressionLevel: 9 } : {})
            })
            .toBuffer();
          targetFormat = metadata.format;
        } else {
          compressedBuffer = await sharpInstance
            .webp({
              quality: parseInt(qualityValue, 10),
              effort: 6,
              alphaQuality: 80,
              smartSubsample: true
            })
            .toBuffer();
          targetFormat = 'webp';
        }
        
        const compressedSize = compressedBuffer.byteLength;
        const savings = 1 - (compressedSize / originalSize);

        // Keep the original if compression resulted in a larger file
        let finalBuffer = compressedBuffer;
        let finalFormat = targetFormat;
        let finalSize = compressedSize;
        let finalSavings = savings;

        if (compressedSize >= originalSize) {
          finalBuffer = Buffer.from(buffer);
          finalFormat = metadata.format;
          finalSize = originalSize;
          finalSavings = 0;
        }
        
        result = {
          success: true,
          originalSize,
          compressedSize: finalSize,
          savings: finalSavings,
          buffer: finalBuffer,
          format: finalFormat,
          strategy: 'sharp'
        };
      } catch (webpError) {
        const pngBuffer = await sharpInstance
          .png({ 
            quality: parseInt(qualityValue, 10),
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
