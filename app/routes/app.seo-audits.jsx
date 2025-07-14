import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  Text,
  Thumbnail,
  Tabs,
  Badge,
  Button,
  Popover,
  TextField,
  Select,
  ProgressBar,
  Toast,
  Divider,
  Box,
} from '@shopify/polaris';
import { json } from '@remix-run/node';
import { useLoaderData, useNavigate, useFetcher, useLocation } from '@remix-run/react';
import { authenticate } from '../shopify.server';
import { findStoredImage } from '../utils/firebaseStorage.server';

/* ───────── loader ───────── */

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const url   = new URL(request.url);
  const page  = Number(url.searchParams.get('page')  || 1);
  const limit = Number(url.searchParams.get('limit') || 8);
  const searchStr = (url.searchParams.get('search') || '').toLowerCase();

  const gql = `{
    products(first: 50) {
      edges {
        node {
          id
          title
          images(first: 1) { edges { node { id url altText } } }
        }
      }
    }
  }`;

  const data = await (await admin.graphql(gql)).json();

  let products = await Promise.all(
    data.data.products.edges.map(async ({ node }) => {
      const img = node.images.edges[0]?.node;
      const alreadyCompressed = img?.url.includes('/files/compressed_');
      return {
        title: node.title,
        imageUrl: img?.url || '',
        productId: node.id.split('/').pop(),
        imageId: img?.id?.split('/').pop() || null,
        alt: img?.altText || '',
        keyword: null,
        issues: 8,

        isCompressed: alreadyCompressed,
        compressedUrl: alreadyCompressed ? img.url : null,
      };
    }) // ← this closing parenthesis was missing
  );

  // Attach persisted compression info
  products = await Promise.all(products.map(async p => {
    try {
      const stored = await findStoredImage(p.imageUrl, p.imageId)
      console.log('FIRESTORE STORED FOR', p.imageUrl, '→', stored);
      if (stored) {                       // log only cache hits
        console.log('[CACHE-HIT]', p.imageUrl, '→', stored.id);
     }
      if (stored) {
        const originalSize = stored.originalSize || stored.size || null;
        const currentSize  = stored.compressedSize || stored.size || null;
        const savingsPct   = (originalSize && currentSize) ? ((1 - currentSize / originalSize) * 100).toFixed(1) : null;
        return {
          ...p,
          originalSize,
          currentSize,
          savingsPct,
          isCompressed: true,
          imageUrl: stored.compressedUrl || stored.url,
          compressedUrl: stored.compressedUrl || stored.url,
        };
      }
    } catch (e) {
      console.error('[loader] findStoredImage error', e);
    }
    return {
      ...p,
      originalSize: p.originalSize ?? null,
      currentSize: p.currentSize ?? null,
      savingsPct: p.savingsPct ?? null,
      isCompressed: p.isCompressed ?? false,
      compressedUrl: p.compressedUrl ?? null,
    };
  }));

  if (searchStr) {
    products = products.filter(p => p.title.toLowerCase().includes(searchStr));
  }

  const totalPages = Math.ceil(products.length / limit);
  const pageItems  = products.slice((page - 1) * limit, page * limit);

  return json({ pageItems, page, totalPages, search: searchStr, itemsPerPage: limit });
}

/* ───────── helpers ───────── */

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const idx = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = (bytes / Math.pow(1024, idx)).toFixed(1);
  return `${val} ${['B', 'KB', 'MB', 'GB'][idx]}`;
}

/* ───────── main component ───────── */

export default function SeoAuditsRoute() {
  const { pageItems, page, totalPages, search, itemsPerPage } = useLoaderData();

  const navigate = useNavigate();
  const fetcher  = useFetcher();
  const location = useLocation();

  /* helpers */
  const navTo = (newPage, newLimit, newSearch) => {
    const current = new URLSearchParams(window.location.search);
    const shopParam = current.get('shop') || undefined;
    const qp = new URLSearchParams({
      page: String(newPage),
      limit: newLimit,
      search: newSearch,
    });
    if (shopParam) qp.set('shop', shopParam);
    navigate(`?${qp.toString()}`);
  };

  /* handlers */
  const handleSearchChange = (val) => {
    setSearchValue(val);
    navTo(1, limitValue, val);
  };

  /* state */
  const [searchValue, setSearchValue] = useState(search);
  const [limitValue,  setLimitValue]  = useState(String(itemsPerPage));

  const [rows, setRows] = useState(
    pageItems.map(p => ({
      ...p,
      imageUrl:      p.compressedUrl || p.imageUrl,
      originalUrl:   p.imageUrl,
      originalSize:  p.originalSize  ?? null,
      currentSize:   p.currentSize   ?? null,
      savingsPct:    p.savingsPct    ?? null,
      isCompressed:  p.isCompressed  ?? false,
      compressedUrl: p.compressedUrl ?? null,
    }))
  );

  useEffect(() => {
    setRows(
      pageItems.map(p => ({
        ...p,
        imageUrl:      p.compressedUrl || p.imageUrl,
        originalUrl:   p.imageUrl,
        originalSize:  p.originalSize  ?? null,
        currentSize:   p.currentSize   ?? null,
        savingsPct:    p.savingsPct    ?? null,
        isCompressed:  p.isCompressed  ?? false,
        compressedUrl: p.compressedUrl ?? null,
      }))
    );
  }, [location.search, pageItems]);

  const [comp, setComp] = useState({
    running: false,
    progress: 0,
    completed: 0,
    total: 0,
    currentUrl: '',
    results: [],
    showPanel: false,
    showToast: false,
    toastMsg: '',
    toastTone: 'success',
    loadingByUrl: {},
  });

  /* start compression */
  function compressUrls(urls, strategy = 'tinify', productIds = [], imageIds = []) {
    if (!urls.length) return;

    setComp(prev => ({
      ...prev,
      running: true,
      progress: 0,
      completed: 0,
      total: urls.length,
      results: [],
      showPanel: true,
      loadingByUrl: { ...prev.loadingByUrl, [urls[0]]: true },
    }));

    // Create a FormData object to submit the files
    const formData = new FormData();
    formData.append('strategy', strategy);
    urls.forEach((url, i) => {
      formData.append('urls', url);
      if (productIds[i]) formData.append('productIds', productIds[i]);
      if (imageIds[i])  formData.append('imageIds',  imageIds[i]);
    });

    console.log('Submitting to /api/compress-images with strategy:', strategy);

    // Submit the form data using the fetcher
    const shopParam = new URLSearchParams(window.location.search).get('shop');
    const actionPath = shopParam ? `/api/compress-images?shop=${encodeURIComponent(shopParam)}` : '/api/compress-images';

    fetcher.submit(formData, {
      method: 'POST',
      action: actionPath,
      encType: 'multipart/form-data'
    });
  }

  /* fetcher response */
  useEffect(() => {
    if (!fetcher.data?.type) return;

    if (fetcher.data.type === 'complete') {
      console.log('COMPLETE received', fetcher.data);
      const ok = fetcher.data.results || [];
      const totO = ok.reduce((s, r) => s + r.originalSize, 0);
      const totC = ok.reduce((s, r) => s + r.compressedSize, 0);
      const pct  = totO ? ((1 - totC / totO) * 100).toFixed(1) : '0';

      setComp(prev => ({
        ...prev,
        running: false,
        progress: 100,
        completed: fetcher.data.totalProcessed,
        results: ok,
        toastMsg: `Compressed ${ok.length} image${ok.length !== 1 ? 's' : ''} · saved ${pct}%`,
        toastTone: fetcher.data.totalErrors ? 'warning' : 'success',
        showToast: true,
        loadingByUrl: {},
      }));

      // update per-row data
      setRows(prev => prev.map(row => {
        const r = ok.find(x => x.url === row.originalUrl && x.success);
        if (!r) return row;
        const pct = r.originalSize
          ? ((1 - r.compressedSize / r.originalSize) * 100).toFixed(1)
          : null;
        return {
          ...row,
          imageUrl:      r.compressedUrl,  // show the new compressed URL
          compressedUrl: r.compressedUrl,
          originalSize:  r.originalSize,
          currentSize:   r.compressedSize,
          savingsPct:    pct,
          isCompressed:  true,
        };
      }));

      /* Keep panel visible; user can choose when to close */
    }
  }, [fetcher.data]);

  /* fetcher error */
  useEffect(() => {
    if (!fetcher.error) return;
    setComp(prev => ({
      ...prev,
      running: false,
      showToast: true,
      toastTone: 'critical',
      toastMsg: 'Compression failed – check server logs',
    }));
  }, [fetcher.error]);

  /* aggregate stats */
  const stats = (() => {
    const list = comp.results;
    if (!list.length) return null;
    const totalO = list.reduce((s, r) => s + r.originalSize, 0);
    const totalC = list.reduce((s, r) => s + r.compressedSize, 0);
    const pct = totalO ? ((1 - totalC / totalO) * 100).toFixed(1) : '0';
    return { totalO, totalC, pct };
  })();

  /* handler: revert */
  function handleRevert(image) {
    const form = new FormData();
    form.append('url', image.originalUrl);
    if (image.productId) form.append('productId', image.productId);
    if (image.imageId)  form.append('imageId',  image.imageId);

    const shopParam = new URLSearchParams(window.location.search).get('shop');
    const actionPath = shopParam ? `/api/revert-image?shop=${encodeURIComponent(shopParam)}` : '/api/revert-image';

    fetcher.submit(form, { method: 'POST', action: actionPath });
  }

  /* listen for revert data */
// SeoAuditsRoute.jsx
  useEffect(() => {
    if (!fetcher.data || fetcher.data.type !== 'reverted') return;
    const { requestedUrl, restoredSize } = fetcher.data;
    const isShopifyCompressed = requestedUrl.includes('/files/compressed_');

    setRows(prev => prev.map(row => {
      if (row.originalUrl !== requestedUrl) return row;
      return {
        ...row,
        imageUrl:     row.originalUrl,
        compressedUrl: null,
        currentSize:  restoredSize,
        savingsPct:   null,
        isCompressed: isShopifyCompressed,
      };
    }));
  }, [fetcher.data]);



  /* UI */
  return (
    <Page title="SEO Audits">
      {/* floating panel */}
      {comp.showPanel && (
        <Box position="fixed" bottom="5" right="5" width="96" padding="4"
             background="bg" borderInlineStartWidth="2" borderColor="border-subdued"
             borderRadius="2" shadow="card" zIndex="overlay">

          <Text variant="bodyMd" fontWeight="semibold">
            {comp.running ? 'Compressing images…' : 'Compression results'}
          </Text>
          <Text variant="bodySm" tone="subdued">
            {comp.completed} of {comp.total}
          </Text>
          <ProgressBar progress={comp.progress} />

          {comp.currentUrl && comp.running && (
            <Text truncate variant="bodySm" tone="subdued">
              {comp.currentUrl.split('/').pop()}

            </Text>
          )}

          {!comp.running && stats && (
            <>
              <Divider />
              <Box paddingBlockStart="2">
                <Text variant="bodySm">
                  Total savings: <strong>{stats.pct}%</strong> &nbsp;
                ({formatFileSize(stats.totalO)} → {formatFileSize(stats.totalC)})
              </Text>
            </Box>
          </>
        )}
      </Box>
    )}

    {comp.showToast && (
      <Toast content={comp.toastMsg} tone={comp.toastTone}
             duration={5000}
             onDismiss={() => setComp(p => ({ ...p, showToast: false }))} />
    )}

    <Card>
      <Tabs tabs={[{ id: 'products', content: 'Products' }]} selected={0} onSelect={() => {}} />

      {/* filters */}
      <Box paddingInline="4" paddingBlockStart="4" display="flex" gap="4">
        <TextField
          value={searchValue} onChange={handleSearchChange} placeholder="Search by title"
          clearButton onClearButtonClick={() => handleSearchChange('')}
        />
        <Select
          labelHidden label="Items per page" options={['8','16','24','32']} value={limitValue}
          onChange={v => { setLimitValue(v); navTo(1, v, searchValue); }}
        />
      </Box>

      {/* table */}
      <Box padding="4" overflow="auto">
        <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: '0 10px' }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 0' }}>Title</th>
              <th style={{ padding: '8px 0' }}>Keyword</th>
              <th style={{ padding: '8px 0' }}>SEO Issues</th>
              <th style={{ padding: '8px 0' }}>Alt Tag</th>
              <th style={{ padding: '8px 0' }}>Size</th>
              <th style={{ padding: '8px 0' }}>Compression</th>
              <th style={{ padding: '8px 0', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, i) => (
              <tr key={i} style={{ background: '#fff' }}>
                <td style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Thumbnail source={item.imageUrl} alt={item.alt || item.title} size="small" />
                  <Text>{item.title}</Text>
                </td>
                <td><Badge tone="critical">Keyword not added</Badge></td>
                <td><Text>{item.issues} suggestions</Text></td>
                <td><Text>{item.alt || 'None'}</Text></td>
                <td>
                  {item.currentSize != null ? (
                    <Text variant="bodySm">
                      {formatFileSize(item.originalSize)} → {formatFileSize(item.currentSize)}
                    </Text>
                  ) : (
                    <Text tone="subdued" variant="bodySm">—</Text>
                  )}
                </td>
                                {/* new combined “Actions” cell */}
                <td
                  style={{
                    textAlign: 'right',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '8px',
                  }}
                >
                  {item.isCompressed ? (
                    <>
                      <Badge tone="success">{item.savingsPct}% smaller</Badge>
                      <Button
                        destructive
                        loading={comp.loadingByUrl[item.originalUrl]}
                        onClick={() => handleRevert(item)}
                      >
                        Revert
                      </Button>
                    </>
                  ) : (
                    <CompressPopover
                      image={item}
                      onCompress={compressUrls}
                      loading={comp.loadingByUrl[item.originalUrl]}
                    />
                  )}
                </td>

              </tr>
            ))}
          </tbody>
        </table>

        {/* pagination */}
        <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:'16px',paddingTop:'24px'}}>
          <Button plain disabled={page <= 1}
                  onClick={() => navTo(page - 1, limitValue, searchValue)}>◀</Button>
          <Text variant="bodySm" tone="subdued">
            Page {page} of {totalPages}
          </Text>
          <Button plain disabled={page >= totalPages}
                  onClick={() => navTo(page + 1, limitValue, searchValue)}>▶</Button>
        </div>
      </Box>
    </Card>
  </Page>
);
}

/* small popover */
function CompressPopover({ image, onCompress, onRevert, loading }) {
const [open, setOpen] = useState(false);
  const handleCompress = (strategy) => {
    onCompress(
      [image.imageUrl],   // urls[0]
      strategy,
      [image.productId],  // productIds[0]
      [image.imageId],    // imageIds[0]  (may be null)
    );
    setOpen(false);
  };

  return (
    <Popover
      active={open}
      onClose={() => setOpen(false)}
      activator={
        <Button onClick={() => setOpen(o => !o)} loading={loading} disabled={loading}>
          Compress
        </Button>
      }
    >
      <Box padding="4" width="200">
        <Button
          fullWidth
          onClick={() => handleCompress('sharp')}
          loading={loading}
          disabled={loading}
          size="slim"
          tone="primary"
          variant="primary"
          textAlign="left"
        >
          Compress with Sharp
        </Button>
        <Box paddingBlockStart="2">
          <Button
            fullWidth
            onClick={() => handleCompress('tinify')}
            loading={loading}
            disabled={loading}
            size="slim"
            tone="primary"
            variant="secondary"
            textAlign="left"
          >
            Compress with Tinify
          </Button>
        </Box>
        <Divider />
        <Box paddingBlockStart="2">
          <Button
            fullWidth
            tone="critical"
            variant="plain"
            disabled={loading || !image.isCompressed}
            onClick={() => {
              onRevert(image);
              setOpen(false);
            }}
          >
            Revert
          </Button>
        </Box>
      </Box>
    </Popover>
  );
}

