import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { RequestsPage } from "~/hub/features/documents/RequestsPage";

const DocumentRequests: NextPageWithLayout = () => <RequestsPage />;

DocumentRequests.getLayout = (page) => getDashboardLayout(page);

export default DocumentRequests;
