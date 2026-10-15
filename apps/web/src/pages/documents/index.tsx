import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { DocumentsPage } from "~/hub/features/documents/DocumentsPage";

const Documents: NextPageWithLayout = () => <DocumentsPage />;

Documents.getLayout = (page) => getDashboardLayout(page);

export default Documents;
