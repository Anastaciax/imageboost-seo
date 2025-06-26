import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import { compressMultipleImages as tinifyCompress } from '../utils/imageCompression.server';
import { compressMultipleImages as sharpCompress } from '../utils/sharpCompression.server';
import { findStoredImage, storeCompressedImage } from '../utils/firebaseStorage.server';

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
    // Optionally include product and image IDs for Shopify replacement
    const productIds = formData.getAll('productIds'); // may contain empty strings
    const imageIds = formData.getAll('imageIds'); // original image ids to delete (optional)

    if (productIds.length && productIds.length !== imageUrls.length) {
      console.warn('[API] productIds length does not match imageUrls length - they will be ignored');
    }
    if (imageIds.length && imageIds.length !== imageUrls.length) {
      console.warn('[API] imageIds length does not match imageUrls length - they will be ignored');
    }

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

    // grab the embedded-app session once;
    // works as long as the route is called from an embedded page.
    const { session } = await authenticate.admin(request);
    const shop        = session?.shop;
    const accessToken = session?.accessToken;

    console.log('[Auth] shop:', shop);
    console.log('[Auth] accessToken present?', !!accessToken);

    // -----------------------------------------------------------------
    // Process images one by one to show progress

    // Process images one by one to show progress
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      try {
        console.log(`\n--- Processing image ${i + 1}/${imageUrls.length}: ${url} ---`);

        // Try to find existing compressed image in storage first
        const storedImage = await findStoredImage(url);
        if (storedImage) {
          console.log('Found existing compressed image in storage:', storedImage.url);
          results.push({
            url,
            success: true,
            originalSize: storedImage.originalSize || 0,
            compressedSize: storedImage.size || 0,
            savings: storedImage.originalSize ? (1 - (storedImage.size / storedImage.originalSize)) : 0,
            format: storedImage.format || 'webp',
            compressedUrl: storedImage.url,
            fromCache: true
          });
          continue;
        }

        // If not found in storage, compress the image
        console.log('No cached version found, compressing...');

        // Get the generator and process all results
        console.log('Creating compression generator...');
        let compressionGenerator;
        let result = null;
        let compressionResults = [];

        try {
          compressionGenerator = compressFunction([url], compressionOptions);
          console.log('Generator created, processing results...');

          // Process all yielded values from the generator
          const firstYield = await compressionGenerator.next();

          if (firstYield.done) {
            console.log('Generator completed without yielding any results');
          } else if (firstYield.value) {
            compressionResults = Array.isArray(firstYield.value) ? firstYield.value : [firstYield.value];
            console.log('First yield from generator:', {
              isArray: Array.isArray(firstYield.value),
              resultsCount: compressionResults.length,
              firstResultKeys: compressionResults[0] ? Object.keys(compressionResults[0]) : 'none'
            });

            // Get the first successful result with a buffer
            result = compressionResults.find(r => r?.success && r?.buffer);

            // If we didn't get a successful result, try to get any result
            if (!result && compressionResults.length > 0) {
              result = compressionResults[0];
              console.log('Using first available result (may not be successful)');
            }
          }
        } catch (genError) {
          console.error('Error in compression generator:', {
            name: genError.name,
            message: genError.message,
            stack: genError.stack
          });
          throw new Error(`Compression failed: ${genError.message}`);
        }

        console.log('Selected result:', {
          success: result?.success,
          hasBuffer: !!result?.buffer,
          originalSize: result?.originalSize,
          compressedSize: result?.compressedSize,
          savings: result?.savings,
          format: result?.format
        });

        if (result?.success && result?.buffer) {
          const savings = 1 - (result.compressedSize / result.originalSize);
          console.log('Compression successful:', {
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            calculatedSavings: `${(savings * 100).toFixed(2)}%`,
            reportedSavings: result.savings ? `${(result.savings * 100).toFixed(2)}%` : 'none',
            format: result.format
          });

          // Store the compressed image in Firebase Storage
          const formatToStore = result.format || 'webp';
          console.log(`[API] Storing image with format: ${formatToStore}`);
          console.log('[API] Compression result:', {
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            format: result.format,
            hasBuffer: !!result.buffer,
            bufferLength: result.buffer?.length
          });

          try {
            const storedImage = await storeCompressedImage(
              result.buffer,
              url,
              {
                originalSize: result.originalSize,
                compressionStrategy: strategy,
                format: formatToStore,
                _compressionMetadata: {
                  originalFormat: result.originalFormat,
                  detectedFormat: result.format,
                  strategy: strategy,
                  timestamp: new Date().toISOString()
                }
              }
            );
            console.log('[API] Image stored successfully at:', storedImage.url);

            const resultToPush = {
              url,
              originalSize: result.originalSize,
              compressedSize: result.compressedSize,
              format: result.format,
              savings: result.savings || savings,
              compressedUrl: storedImage.url,
              fromCache: false,
              storedFormat: formatToStore
            };

            console.log('[API] Final result being pushed:', {
              url: resultToPush.url,
              originalSize: resultToPush.originalSize,
              compressedSize: resultToPush.compressedSize,
              format: resultToPush.format,
              storedFormat: resultToPush.storedFormat,
              savings: resultToPush.savings
            });

            // After storing, optionally replace image on Shopify
            if (shop && accessToken && productIds[i]) {
              try {
                const productId = productIds[i];
                const oldImageId = imageIds[i] || null;

                // 1. Create new product image using REST Admin API 2025-01
                const createRes = await fetch(`https://${shop}/admin/api/2025-01/products/${productId}/images.json`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                    'Accept': 'application/json'
                  },
                  body: JSON.stringify({ image: { src: storedImage.url } })
                });
                const createJson = await createRes.json();
                if (!createRes.ok) {
                  throw new Error(`Create image failed: ${createRes.status} - ${JSON.stringify(createJson)}`);
                }
                const newImageId = createJson.image?.id;

                // 2. Delete old image if provided
                if (oldImageId) {
                  await fetch(`https://${shop}/admin/api/2025-01/products/${productId}/images/${oldImageId}.json`, {
                    method: 'DELETE',
                    headers: {
                      'X-Shopify-Access-Token': accessToken,
                      'Accept': 'application/json'
                    }
                  });
                }

                resultToPush.shopify = {
                  productId,
                  newImageId,
                  oldImageId,
                  replaced: true
                };
              } catch (shopifyErr) {
                console.error('[API] Shopify image replace error:', shopifyErr);
                resultToPush.shopify = {
                  replaced: false,
                  error: shopifyErr.message
                };
              }
            }

            results.push(resultToPush);
          } catch (storageError) {
            console.error('Error storing image in Firebase:', storageError);
            // Still return the result even if storage fails
            results.push({
              ...result,
              savings: result.savings || savings,
              compressedUrl: url, // Fallback to original URL
              fromCache: false,
              storageError: storageError.message
            });
          }
        } else {
          console.warn('No result returned from compression function');
          results.push({
            url,
            success: false,
            error: 'Compression failed',
            strategy
          });
        }

        // Log progress
        const progress = Math.round(((i + 1) / imageUrls.length) * 100);
        console.log(`Progress: ${progress}% - Processed ${i + 1} of ${imageUrls.length} images`);

      } catch (error) {
        console.error(`Error processing image ${url} with ${strategy}:`, {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: error.code,
          details: error.details || 'No additional details'
        });

        results.push({
          url,
          success: false,
          error: error.message,
          errorDetails: {
            code: error.code,
            name: error.name,
            details: error.details
          },
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
