import { createFileRoute } from "@tanstack/react-router";
import GateTerminal from "@/components/GateTerminal";

export const Route = createFileRoute("/checkout")({
  component: () => <GateTerminal mode="checkout" />,
});