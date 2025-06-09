import React, { useState, useEffect, useRef } from 'react';
import {
  Page,
  Card,
  Text,
  Thumbnail,
  Tabs,
  Badge,
  Button,
  Popover,
  ActionList,
  TextField,
  Select,
  ProgressBar,
  Toast,
  Divider,
  Box,
} from '@shopify/polaris';
import { json } from '@remix-run/node';
import { useLoaderData, useNavigate, useFetcher } from '@remix-run/react';
import { authenticate } from '../shopify.server';

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
          title
          images(first: 1) { edges { node { url altText } } }
        }
      }
    }
  }`;

  const data = await (await admin.graphql(gql)).json();

  let products = data.data.products.edges.map(({ node }) => {
    const img = node.images.edges[0]?.node;
    return {
      title: node.title,
      imageUrl: img?.url || '',
      alt: img?.altText || '',
      keyword: null,
      issues: 8,
    };
  });

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

  /* state */
  const [searchValue, setSearchValue] = useState(search);
  const [limitValue,  setLimitValue]  = useState(String(itemsPerPage));

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
  function compressUrls(urls) {
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

    const fd = new FormData();
    fd.append('imageUrls', JSON.stringify(urls));
    fetcher.submit(fd, { method: 'POST', action: '/api/compress-images', encType: 'multipart/form-data' });
  }

  /* fetcher response */
  useEffect(() => {
    if (!fetcher.data?.type) return;

    if (fetcher.data.type === 'complete') {
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

      /* hide panel after 2 s */
      setTimeout(() => setComp(p => ({ ...p, showPanel: false })), 2000);
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

  /* search / pagination */
  function navTo(newPage, newLimit, newSearch) {
    const qp = new URLSearchParams({ page: String(newPage), limit: newLimit, search: newSearch });
    navigate(`?${qp.toString()}`);
  }

  /* aggregate stats */
  const stats = (() => {
    const list = comp.results;
    if (!list.length) return null;
    const totalO = list.reduce((s, r) => s + r.originalSize, 0);
    const totalC = list.reduce((s, r) => s + r.compressedSize, 0);
    const pct = totalO ? ((1 - totalC / totalO) * 100).toFixed(1) : '0';
    return { totalO, totalC, pct };
  })();

  /* merge per-row badge */
  const rows = pageItems.map(p => {
    const r = comp.results.find(x => x.url === p.imageUrl && x.success);
    return r ? { ...p, savingsPct: (r.savings * 100).toFixed(1) } : p;
  });

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
            value={searchValue} onChange={setSearchValue} placeholder="Search by title"
            clearButton onClearButtonClick={() => setSearchValue('')}
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
                    {item.savingsPct
                      ? <Badge tone="success">{item.savingsPct}% smaller</Badge>
                      : <Text tone="subdued" variant="bodySm">—</Text>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <CompressPopover
                      image={item}
                      onCompress={compressUrls}
                      loading={comp.loadingByUrl[item.imageUrl]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* pagination */}
          <Box display="flex" justifyContent="center" alignItems="center" gap="4" paddingBlockStart="6">
            <Button plain disabled={page <= 1}
                    onClick={() => navTo(page - 1, limitValue, searchValue)}>◀</Button>
            <Text variant="bodySm" tone="subdued">
              Page {page} of {totalPages}
            </Text>
            <Button plain disabled={page >= totalPages}
                    onClick={() => navTo(page + 1, limitValue, searchValue)}>▶</Button>
          </Box>
        </Box>
      </Card>
    </Page>
  );
}

/* small popover */
function CompressPopover({ image, onCompress, loading }) {
  const [open, setOpen] = useState(false);
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
      <Box padding="4" width="64">
        <ActionList items={[{
          content: 'Compress this image',
          onAction() {
            onCompress([image.imageUrl]);
            setOpen(false);
          },
        }]} />
      </Box>
    </Popover>
  );
}
