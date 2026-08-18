import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, Fingerprint, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { apiRequest } from "@/api/client";
import { endpoints } from "@/api/endpoints";
import { queryKeys } from "@/api/query-keys";
import { fetchRecentRequests } from "@/lib/admin-queries";
import { getCameraRuntimeIssue, requestUserCamera } from "@/lib/camera-runtime";
import { getErrorMessage } from "@/lib/errors";

type DeviceStatus = {
  success?: boolean;
  connected: boolean;
  configured: boolean;
  deviceModel?: string | null;
  serialNumber?: string | null;
  code?: string;
};

type CheckoutResult = {
  success: boolean;
  matched?: boolean;
  code?: string;
  message?: string;
  accessGranted?: boolean;
  action?: string | null;
  checkedOutAt?: string | null;
  passId?: string | null;
  gatePassUrl?: string | null;
  cadet?: {
    id?: string;
    roll?: string;
    name?: string;
  };
};

function captureVideoFrame(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight) throw new Error("The camera frame is not ready.");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not capture the camera frame.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.92);
}

export function BiometricGateCheckout() {
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [selectedCadetId, setSelectedCadetId] = useState("");
  const [faceFallback, setFaceFallback] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [result, setResult] = useState<CheckoutResult | null>(null);

  const { data: requests = [], isLoading: requestsLoading } = useQuery({
    queryKey: ["admin", "biometric-checkout-leaves"],
    queryFn: fetchRecentRequests,
    refetchInterval: 15_000,
  });
  const { data: device, isLoading: deviceLoading, refetch: refreshDevice } = useQuery({
    queryKey: queryKeys.admin.fingerprintDevice,
    queryFn: () => apiRequest<DeviceStatus>(endpoints.fingerprint.deviceStatus),
    refetchInterval: 10_000,
  });

  const approved = useMemo(
    () => requests.filter((request) => request.status === "approved"),
    [requests],
  );
  const selected = approved.find((request) => {
    const cadetId = request.cadet?.cadet_code || request.roll || request.cadet_id || "";
    return cadetId === selectedCadetId;
  });

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const refreshGateData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.summary }),
      queryClient.invalidateQueries({ queryKey: ["admin", "biometric-checkout-leaves"] }),
      queryClient.invalidateQueries({ queryKey: ["admin", "recent-gate"] }),
    ]);
  };

  const fingerprintMutation = useMutation({
    mutationFn: () => apiRequest<CheckoutResult>(endpoints.fingerprint.verify, {
      method: "POST",
      body: JSON.stringify({
        ...(selectedCadetId ? { cadetId: selectedCadetId } : {}),
        direction: "CHECK_OUT",
        terminal: "Gate Officer Dashboard",
      }),
    }),
    onSuccess: async (response) => {
      setResult(response);
      setFaceFallback(false);
      await refreshGateData();
      toast.success(response.message || "Fingerprint verified. Gate access approved.");
    },
    onError: (error: unknown) => {
      setResult(null);
      setFaceFallback(true);
      toast.error(getErrorMessage(error, "Fingerprint verification failed. Use face verification."));
    },
  });

  async function startFaceCamera() {
    setCameraError("");
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await requestUserCamera();
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      setCameraError(getCameraRuntimeIssue(error, "face verification").message);
    }
  }

  const faceMutation = useMutation({
    mutationFn: async () => {
      if (!videoRef.current) throw new Error("Start the camera before face verification.");
      const checkOutPhotoUrl = captureVideoFrame(videoRef.current);
      return apiRequest<CheckoutResult>(endpoints.gate.checkOut, {
        method: "POST",
        body: JSON.stringify({
          roll: selectedCadetId,
          method: "face",
          checkOutPhotoUrl,
        }),
      });
    },
    onSuccess: async (response) => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setResult(response);
      setFaceFallback(false);
      await refreshGateData();
      toast.success(response.message || "Face verified. Gate access approved.");
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, "Face verification failed. Please retry."));
    },
  });

  const busy = fingerprintMutation.isPending || faceMutation.isPending;
  const selectedName = result?.cadet?.name || selected?.cadet?.full_name || selected?.roll || "Cadet";

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card/70 p-5 backdrop-blur-md sm:p-6" aria-labelledby="biometric-checkout-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-primary" />
            <h2 id="biometric-checkout-title" className="text-lg font-semibold tracking-tight">Biometric gate checkout</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Fingerprint is primary. Face verification opens only when fingerprint verification fails.
          </p>
        </div>
        <button type="button" onClick={() => void refreshDevice()} className="inline-flex items-center gap-2 self-start rounded-full border border-border bg-background px-3 py-2 text-xs font-semibold">
          <RefreshCw className={`h-3.5 w-3.5 ${deviceLoading ? "animate-spin" : ""}`} />
          {device?.connected ? `${device.deviceModel || "Scanner"} online` : "Scanner offline"}
        </button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
        <div className="rounded-xl border border-border bg-background/70 p-4">
          <label htmlFor="biometric-cadet" className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Cadet for face fallback (optional)
          </label>
          <select
            id="biometric-cadet"
            value={selectedCadetId}
            disabled={busy || requestsLoading}
            onChange={(event) => {
              setSelectedCadetId(event.target.value);
              setFaceFallback(false);
              setResult(null);
              setCameraError("");
              streamRef.current?.getTracks().forEach((track) => track.stop());
            }}
            className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
          >
            <option value="">{requestsLoading ? "Loading approved leaves..." : "Fingerprint will identify the cadet automatically"}</option>
            {approved.map((request) => {
              const id = request.cadet?.cadet_code || request.roll || request.cadet_id || request.id;
              return <option key={request.id} value={id}>{request.cadet?.full_name || request.roll || id} · {id}</option>;
            })}
          </select>
          <button
            type="button"
            disabled={!device?.connected || busy}
            onClick={() => fingerprintMutation.mutate()}
            className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            {fingerprintMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
            {fingerprintMutation.isPending ? "Waiting for fingerprint..." : "Start fingerprint verification"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            No checkout confirmation is required. A successful match identifies the cadet, records checkout, issues and emails the gate pass, writes the audit log, and approves gate access automatically.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-background/70 p-4">
          {result?.success ? (
            <div className="flex h-full min-h-40 flex-col justify-center">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="mt-3 font-semibold">Access approved for {selectedName}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Checked out {result.checkedOutAt ? new Date(result.checkedOutAt).toLocaleString() : "now"}
                {result.passId ? ` · Pass ${result.passId}` : ""}
              </p>
            </div>
          ) : faceFallback ? (
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold"><Camera className="h-4 w-4" /> Face fallback</div>
              <video ref={videoRef} playsInline muted className="mt-3 aspect-video w-full rounded-xl bg-slate-950 object-cover" />
              {cameraError && <p className="mt-2 text-xs text-destructive">{cameraError}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void startFaceCamera()} disabled={busy} className="rounded-full border border-border px-4 py-2 text-xs font-semibold">
                  Start camera
                </button>
                <button type="button" onClick={() => faceMutation.mutate()} disabled={busy || !streamRef.current || !selectedCadetId} className="rounded-full bg-foreground px-4 py-2 text-xs font-semibold text-background disabled:opacity-50">
                  {faceMutation.isPending ? "Verifying..." : "Verify face"}
                </button>
              </div>
              {!selectedCadetId && <p className="mt-2 text-xs text-muted-foreground">Select the approved cadet before using face fallback.</p>}
            </div>
          ) : (
            <div className="flex h-full min-h-40 flex-col justify-center">
              <ShieldAlert className="h-7 w-7 text-muted-foreground" />
              <p className="mt-3 text-sm font-semibold">Awaiting identity verification</p>
              <p className="mt-1 text-xs text-muted-foreground">Begin fingerprint capture. The backend identifies the cadet and validates the approved leave.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
