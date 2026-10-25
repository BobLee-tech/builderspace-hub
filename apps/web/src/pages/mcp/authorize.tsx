import type { GetServerSideProps } from "next";

import { AuthorizePage } from "~/hub/features/mcp/AuthorizePage";

/**
 * Rendered on the server only to send these headers: the consent page must
 * never sit in a frame, or a page that framed it could steer a click onto 允许.
 */
export const getServerSideProps: GetServerSideProps = ({ res }) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  return Promise.resolve({ props: {} });
};

export default AuthorizePage;
