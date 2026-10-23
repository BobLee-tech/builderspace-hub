import { copy } from "~/hub/copy/zh";
import { FormsList } from "../forms/FormsPage";
import { AdminLayout } from "./AdminLayout";

/**
 * 表单 in the back office: the same list as in the workspace, so the forms
 * and their answers are a click away from the rest of the back office.
 * Opening one goes to its page in the workspace.
 */
export function FormsAdminPage() {
  return (
    <AdminLayout title={copy.forms.title}>
      <FormsList />
    </AdminLayout>
  );
}
