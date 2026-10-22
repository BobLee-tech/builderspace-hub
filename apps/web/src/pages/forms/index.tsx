import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { FormsPage } from "~/hub/features/forms/FormsPage";

const Forms: NextPageWithLayout = () => <FormsPage />;

Forms.getLayout = (page) => getDashboardLayout(page);

export default Forms;
