import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import { findOriginalImage } from '../utils/firebaseStorage.server';

/**
 * POST /api/revert-image
 * Body: FormData { url: originalImageUrl, productId?, imageId? }
 *
 * Finds the stored ORIGINAL image for the supplied `url` (or the current
 * compressed image url – we always key by the original URL) and, if Shopify
 * identifiers are provided, replaces the compressed product image with the
 * original.
 */
export async function action({ request }) {
  try {
    // must be POST
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405 });
    }

    // admin / session – required only if we need to push to Shopify
    const { session } = await authenticate.admin(request);
    const shop        = session?.shop;
    const accessToken = session?.accessToken;

    const form = await request.formData();
    const originalUrl = form.get('url');
    const productId   = form.get('productId'); // Shopify product numeric id
    const oldImageId  = form.get('imageId');   // existing compressed image id

    if (!originalUrl) {
      return json({ error: 'url is required' }, { status: 400 });
    }

    const original = await findOriginalImage(originalUrl);
    if (!original) {
      return json({ error: 'Original image not found' }, { status: 404 });
    }

    let shopifyResult = null;

    if (productId && accessToken && shop) {
      try {
        // 1. upload original url to product images
        const createRes = await fetch(`https://${shop}/admin/api/2025-01/products/${productId}/images.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
            'Accept': 'application/json'
          },
          body: JSON.stringify({ image: { src: original.storedUrl } })
        });
        const createJson = await createRes.json();
        if (!createRes.ok) throw new Error(JSON.stringify(createJson));
        const newImageId = createJson.image?.id;

        // 2. delete the compressed (old) image if provided
        if (oldImageId) {
          await fetch(`https://${shop}/admin/api/2025-01/products/${productId}/images/${oldImageId}.json`, {
            method: 'DELETE',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Accept': 'application/json'
            }
          });
        }

        shopifyResult = { replaced: true, newImageId, oldImageId };
      } catch (err) {
        console.error('[revert-image] Shopify revert error', err);
        shopifyResult = { replaced: false, error: err.message };
      }
    }

    return json({
      type: 'reverted',
      requestedUrl: originalUrl,
      restoredSize: original.size,
      originalUrl: original.storedUrl,
      originalSize: original.size,
      format: original.format,
      shopify: shopifyResult
    });
  } catch (err) {
    console.error('[revert-image] Error', err);
    return json({ error: err.message }, { status: 500 });
  }
}
