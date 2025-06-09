import { json } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import shopify from "./shopify.server.js";
import { Frame } from "@shopify/polaris";

export async function loader({ request }) {
  await shopify.authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY });
}

export default function Root() {
  const { apiKey } = useLoaderData();

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <AppProvider apiKey={apiKey} isEmbeddedApp>
        <Frame>
          <Outlet />
        </Frame>
        </AppProvider>

        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
