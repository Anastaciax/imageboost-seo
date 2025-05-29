import React, { useState, useEffect } from 'react';
import {
  Page,
  Card,
  Text,
  Thumbnail,
  Tabs,
  Badge,
  Button,
  InlineStack,
  Popover,
  ActionList,
  TextField,
  Select,
} from '@shopify/polaris';
import { json } from '@remix-run/node';
import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { authenticate } from '../shopify.server';

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const itemsPerPage = parseInt(url.searchParams.get('limit') || '8', 10);
  const search = url.searchParams.get('search')?.toLowerCase() || '';

  const response = await admin.graphql(`{
    products(first: 50) {
      edges {
        node {
          title
          images(first: 1) {
            edges {
              node {
                id
                url
                altText
              }
            }
          }
        }
      }
    }
  }`);

  const data = await response.json();

  let allProducts = data.data.products.edges.map(edge => {
    const product = edge.node;
    const image = product.images.edges[0]?.node;
    return {
      title: product.title,
      imageUrl: image?.url || '',
      alt: image?.altText || '',
      keyword: null,
      issues: 8,
    };
  });

  if (search) {
    allProducts = allProducts.filter(p => p.title.toLowerCase().includes(search));
  }

  const totalPages = Math.ceil(allProducts.length / itemsPerPage);
  const pageItems = allProducts.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  return json({ pageItems, page, totalPages, search, itemsPerPage });
}

export default function SeoAuditsRoute() {
  const { pageItems, page, totalPages, search, itemsPerPage } = useLoaderData();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(search || '');
  const [limitValue, setLimitValue] = useState(itemsPerPage.toString());

  useEffect(() => {
    navigate(`?page=1&limit=${limitValue}&search=${encodeURIComponent(searchValue)}`);
  }, [searchValue]);

  const tabs = [
    { id: 'products', content: 'Products' },
    { id: 'special', content: 'Special Pages' },
    { id: 'auto', content: 'Automated Collections' },
    { id: 'custom', content: 'Custom Collections' },
    { id: 'other', content: 'Other Pages' },
    { id: 'blog', content: 'Blog Posts' },
  ];

  function updateQuery(newPage, newLimit, newSearch) {
    const params = new URLSearchParams();
    if (newPage) params.set('page', newPage);
    if (newLimit) params.set('limit', newLimit);
    if (newSearch) params.set('search', newSearch);
    navigate(`?${params.toString()}`);
  }

  function handlePagination(newPage) {
    updateQuery(newPage, limitValue, searchValue);
  }

  function DetailsPopover({ image }) {
    const [active, setActive] = useState(false);
    const toggleActive = () => setActive((prev) => !prev);

    return (
      <Popover
        active={active}
        activator={<Button onClick={toggleActive}>Details</Button>}
        onClose={toggleActive}
      >
        <ActionList
          items={[
            { content: `Filename: ${image.imageUrl.split('/').pop()}` },
            { content: `Alt tag: ${image.alt || 'None'}` },
            { content: `SEO Suggestions: ${image.issues}` },
          ]}
        />
      </Popover>
    );
  }

  return (
    <Page title="SEO Audits">
      <Card>
        <Tabs tabs={tabs} selected={0} onSelect={() => {}} />

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '1rem 1rem 0' }}>
          <TextField
            value={searchValue}
            onChange={setSearchValue}
            placeholder="Search by title"
            autoComplete="off"
            clearButton
            onClearButtonClick={() => setSearchValue('')}
          />
          <Select
            labelHidden
            label="Items per page"
            options={['8', '16', '24', '32']}
            value={limitValue}
            onChange={(value) => {
              setLimitValue(value);
              updateQuery(1, value, searchValue);
            }}
          />
        </div>

        <div style={{ padding: '1rem', maxWidth: '100%', overflowX: 'auto' }}>
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: '0 10px' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '8px 0' }}>Title</th>
                <th style={{ padding: '8px 0' }}>Keyword</th>
                <th style={{ padding: '8px 0' }}>SEO Issues</th>
                <th style={{ padding: '8px 0' }}>Alt Tag</th>
                <th style={{ padding: '8px 0', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((item, idx) => (
                <tr key={idx} style={{ background: '#fff' }}>
                  <td style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Thumbnail source={item.imageUrl} alt={item.alt || item.title} size="small" />
                    <Text>{item.title}</Text>
                  </td>
                  <td>
                    <Badge tone="critical">Keyword not added</Badge>
                  </td>
                  <td>
                    <Text>{item.issues} suggestions</Text>
                  </td>
                  <td>
                    <Text>{item.alt || 'None'}</Text>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <DetailsPopover image={item} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ textAlign: 'center', marginTop: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '24px' }}>
            <Button
              disabled={page <= 1}
              onClick={() => handlePagination(page - 1)}
              plain
            >
              ◀
            </Button>
            <Text variant="bodySm" tone="subdued">
              Page {page} of {totalPages}
            </Text>
            <Button
              disabled={page >= totalPages}
              onClick={() => handlePagination(page + 1)}
              plain
            >
              ▶
            </Button>
          </div>
        </div>
      </Card>
    </Page>
  );
}
