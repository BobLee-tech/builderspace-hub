import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { RemindersPage } from "~/hub/features/nudges/RemindersPage";

const Reminders: NextPageWithLayout = () => <RemindersPage />;

Reminders.getLayout = (page) => getDashboardLayout(page);

export default Reminders;
