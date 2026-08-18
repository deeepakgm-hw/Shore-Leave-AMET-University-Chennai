import { getErrorMessage } from "@/lib/errors";

export type CameraRuntimeStatus = "denied" | "unavailable" | "error";

export type CameraRuntimeIssue = {
  status: CameraRuntimeStatus;
  message: string;
};

type CameraPurpose = "face verification" | "face enrollment";

function formatBrowserError(error: unknown) {
  if (error instanceof DOMException) return `${error.name}: ${error.message}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function logCameraRuntime(label: string, phase: string, error?: unknown) {
  if (!import.meta.env.DEV || import.meta.env.VITE_CAMERA_DEBUG !== "true") return;
  if (typeof window === "undefined") {
    console.info(`[CameraRuntime:${label}] ${phase}: server render`);
    return;
  }

  const runtimeNavigator = window.navigator;
  const mediaDevices = runtimeNavigator?.mediaDevices;
  const getUserMedia = mediaDevices?.getUserMedia;
  const snapshot = {
    hasMediaDevices: !!mediaDevices,
    hasGetUserMedia: typeof getUserMedia === "function",
    isSecureContext: window.isSecureContext,
    error: error ? formatBrowserError(error) : undefined,
  };

  console.info(`[CameraRuntime:${label}] ${phase}`, snapshot);
}

export function getCameraRuntimeIssue(error: unknown, purpose: CameraPurpose): CameraRuntimeIssue {
  if (typeof window === "undefined") {
    return {
      status: "unavailable",
      message: `Camera access for ${purpose} can only be checked in the browser after the page hydrates.`,
    };
  }

  const runtimeNavigator = window.navigator;
  const secureContext = window.isSecureContext;
  const origin = window.location.origin;

  if (!runtimeNavigator) {
    return {
      status: "unavailable",
      message: "Camera access failed because this browser did not expose window.navigator.",
    };
  }

  if (!secureContext) {
    return {
      status: "unavailable",
      message: `Camera access is blocked because this page is not a secure context (${origin}). Open the app on HTTPS or localhost, then retry camera permission.`,
    };
  }

  if (!runtimeNavigator.mediaDevices) {
    return {
      status: "unavailable",
      message: "Camera access failed because this browser did not expose navigator.mediaDevices even though the page is secure. Refresh the page or update the browser.",
    };
  }

  if (typeof runtimeNavigator.mediaDevices.getUserMedia !== "function") {
    return {
      status: "unavailable",
      message: "Camera access failed because this browser does not provide navigator.mediaDevices.getUserMedia().",
    };
  }

  if (error instanceof DOMException) {
    if (["NotAllowedError", "PermissionDeniedError"].includes(error.name)) {
      return {
        status: "denied",
        message: `Camera access is required for ${purpose}. Browser error: ${error.name}. Allow camera permission for this site and retry.`,
      };
    }
    if (["NotFoundError", "DevicesNotFoundError"].includes(error.name)) {
      return {
        status: "unavailable",
        message: `No camera device was found. Browser error: ${error.name}. Connect a camera or switch to a device with a camera.`,
      };
    }
    if (error.name === "NotReadableError") {
      return {
        status: "error",
        message: `The camera is already in use or cannot be read. Browser error: ${error.name}. Close other camera apps and retry.`,
      };
    }
    if (["OverconstrainedError", "ConstraintNotSatisfiedError"].includes(error.name)) {
      return {
        status: "error",
        message: `The selected camera cannot satisfy the requested video settings. Browser error: ${error.name}. Retry with the default camera.`,
      };
    }
    if (["NotSupportedError", "TypeError"].includes(error.name)) {
      return {
        status: "unavailable",
        message: `This browser cannot start the camera on the current page. Browser error: ${error.name}. Use current Chrome, Edge, Safari, or Samsung Internet over HTTPS.`,
      };
    }
    if (error.name === "AbortError") {
      return {
        status: "error",
        message: `The camera request was interrupted. Browser error: ${error.name}. Retry camera access.`,
      };
    }
    if (error.name === "SecurityError") {
      return {
        status: "unavailable",
        message: `Camera access is blocked by browser security. Browser error: ${error.name}. Open over HTTPS or localhost and retry.`,
      };
    }
    return {
      status: "error",
      message: `Camera request failed. Browser error: ${error.name}: ${error.message}`,
    };
  }

  if (error instanceof Error && error.message === "camera-api-missing") {
    return {
      status: "unavailable",
      message: "Camera access failed because getUserMedia was not available at runtime after hydration.",
    };
  }

  return {
    status: "error",
    message: getErrorMessage(error, `Camera access failed during ${purpose}`),
  };
}

export async function requestUserCamera() {
  if (typeof window === "undefined") throw new Error("camera-api-missing");
  const getUserMedia = window.navigator?.mediaDevices?.getUserMedia;
  if (typeof getUserMedia !== "function") throw new Error("camera-api-missing");
  try {
    return await getUserMedia.call(window.navigator.mediaDevices, {
      video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (error) {
    if (error instanceof DOMException && ["OverconstrainedError", "ConstraintNotSatisfiedError"].includes(error.name)) {
      return getUserMedia.call(window.navigator.mediaDevices, { video: true, audio: false });
    }
    throw error;
  }
}
