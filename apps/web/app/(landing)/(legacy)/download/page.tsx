import { notFound } from "next/navigation";

export default function DownloadPage() {
  // Client downloads stay unavailable until this project ships its own releases.
  notFound();
}
