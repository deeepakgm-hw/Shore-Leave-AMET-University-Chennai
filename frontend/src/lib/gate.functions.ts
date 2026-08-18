import { apiRequest } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import type { Cadet, GateActionResult, MutationResult } from "@/types";

type Wrapped<T> = { data: T };
type GateInput = { nfcUid: string; device?: string; gateName?: string };

export const nfcCheckIn = ({ data }: Wrapped<GateInput>) =>
  apiRequest<GateActionResult>(endpoints.gate.checkIn, { method: "POST", body: JSON.stringify({ ...data, method: "nfc" }) });

export const nfcCheckOut = ({ data }: Wrapped<GateInput & { leaveId?: string }>) =>
  apiRequest<GateActionResult>(endpoints.gate.checkOut, { method: "POST", body: JSON.stringify({ ...data, method: "nfc" }) });

export const assignNfcUid = ({ data }: Wrapped<{ cadetId: string; uid: string }>) =>
  apiRequest<MutationResult>(endpoints.nfc.register, {
    method: "POST", body: JSON.stringify({ cadetId: data.cadetId, uid: data.uid }),
  });

export const lookupCadetByRoll = ({ data }: Wrapped<{ roll: string }>) =>
  apiRequest<Cadet>(endpoints.cadets.byRoll(data.roll));
