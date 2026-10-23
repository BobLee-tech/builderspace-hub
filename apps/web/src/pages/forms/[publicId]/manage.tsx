import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { FormManagePage } from "~/hub/features/forms/FormManagePage";

const ManageForm: NextPageWithLayout = () => <FormManagePage />;

ManageForm.getLayout = (page) => getDashboardLayout(page);

export default ManageForm;
