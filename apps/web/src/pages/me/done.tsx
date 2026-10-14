import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { ArchivePage } from "~/hub/features/archive/ArchivePage";

const Done: NextPageWithLayout = () => <ArchivePage />;

Done.getLayout = (page) => getDashboardLayout(page);

export default Done;
