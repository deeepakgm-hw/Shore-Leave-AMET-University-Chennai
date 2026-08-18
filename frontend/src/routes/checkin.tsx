import { createFileRoute } from "@tanstack/react-router";
import GateTerminal from "@/components/GateTerminal";

export const Route = createFileRoute("/checkin")({
  component: () => <GateTerminal mode="checkin" />,
});