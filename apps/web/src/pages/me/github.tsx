import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { GitHubPage } from "~/hub/features/github/GitHubPage";

const GitHub: NextPageWithLayout = () => <GitHubPage />;

GitHub.getLayout = (page) => getDashboardLayout(page);

export default GitHub;
