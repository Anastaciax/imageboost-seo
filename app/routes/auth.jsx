import shopify from "../shopify.server.js";

export const loader = ({ request }) => shopify.authenticate.admin(request);

export default function Auth() {
  return null;
}
