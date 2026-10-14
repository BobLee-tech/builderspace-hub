import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { SchedulePage } from "~/hub/features/schedule/SchedulePage";

const Me: NextPageWithLayout = () => <SchedulePage />;

Me.getLayout = (page) => getDashboardLayout(page);

export default Me;
