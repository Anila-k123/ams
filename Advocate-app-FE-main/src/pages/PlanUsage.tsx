// Plan & Usage: this firm's AMS subscription - plan, status, limits and use.
// Read-only: plans and limits are changed by the AMS team, never from here.
import { useEffect, useState } from "react";
import api, { errorMessage } from "../api/client";
import { EmptyState, PageHead, Panel, Skel } from "../ui/kit";
import SubscriptionUsage, { type SubscriptionSummary } from "../ui/SubscriptionUsage";

export default function PlanUsage() {
  const [data, setData] = useState<SubscriptionSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/api/firm/subscription").then((r) => setData(r.data))
      .catch((e) => setError(errorMessage(e, "Couldn't load the plan.")));
  }, []);

  return (
    <div>
      <PageHead title="Plan & Usage" sub="Your firm's AMS plan, what it includes and how much is used. To change the plan, contact the AMS team." />
      {error ? <EmptyState icon="info" title="Not available" text={error} />
        : !data ? <Skel h={200} />
        : <Panel><SubscriptionUsage data={data} /></Panel>}
    </div>
  );
}
