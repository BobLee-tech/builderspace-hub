import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { DocumentPage } from "~/hub/features/documents/DocumentPage";

const Document: NextPageWithLayout = () => <DocumentPage />;

Document.getLayout = (page) => getDashboardLayout(page);

export default Document;
