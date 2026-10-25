import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { McpPage } from "~/hub/features/mcp/McpPage";

const Mcp: NextPageWithLayout = () => <McpPage />;

Mcp.getLayout = (page) => getDashboardLayout(page);

export default Mcp;
