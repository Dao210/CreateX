/** Pending chat attachments with preview, retry and removal controls. */
import { useMemo } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { resolveAttachmentUrl } from "@/lib/attachment-url";
import { useLightbox } from "@/lib/markdown/lightbox-provider";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/i18n";

export type ComposerAttachmentStatus = "uploading" | "completed" | "failed";

export interface ComposerAttachmentItem {
  /** Stable local id assigned by the composer when the user picked. Used as
   *  the React key AND as the lookup id for status transitions. We don't use
   *  the server-returned `id` because it doesn't exist yet during upload. */
  localId: string;
  /** `file://...` from expo-image-picker / expo-document-picker. Source of
   *  truth for lightbox preview even post-upload — on-device cache. */
  localUri: string;
  filename: string;
  mimeType: string;
  status: ComposerAttachmentStatus;
  /** Populated when status === "completed" — the server-side attachment id
   *  that the chat message will reference via `attachmentIds`. */
  id?: string;
  /** Populated when status === "completed" — canonical `mc://file/<id>`
   *  URL the server returns. The composer submits by id, not url; the
   *  field is kept for inline-insert affordances or debugging. */
  url?: string;
  /** Populated when status === "completed" — signed HTTPS link to open in
   *  Safari for file chips. Mirrors web's "download" path. */
  downloadUrl?: string;
  /** Populated when status === "failed" — short human-readable error. */
  error?: string;
}

interface Props {
  attachments: ComposerAttachmentItem[];
  onRemoveAttachment: (localId: string) => void;
  onRetryAttachment?: (localId: string) => void;
}

export function ComposerAttachmentRow({
  attachments,
  onRemoveAttachment,
  onRetryAttachment,
}: Props) {
  if (attachments.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6, paddingHorizontal: 2, paddingVertical: 2 }}
      keyboardShouldPersistTaps="handled"
    >
      {attachments.map((a) => (
        <AttachmentChipView
          key={a.localId}
          item={a}
          onRemove={onRemoveAttachment}
          onRetry={onRetryAttachment}
        />
      ))}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Attachment chip — image / file capsule with status overlay.
// ---------------------------------------------------------------------------

interface AttachmentChipProps {
  item: ComposerAttachmentItem;
  onRemove: (localId: string) => void;
  onRetry?: (localId: string) => void;
}

function AttachmentChipView({ item, onRemove, onRetry }: AttachmentChipProps) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { open } = useLightbox();
  const { t } = useT("execution");

  const isImage = useMemo(
    () => item.mimeType.startsWith("image/"),
    [item.mimeType],
  );

  const onPress = () => {
    if (item.status === "failed" && onRetry) {
      onRetry(item.localId);
      return;
    }
    if (item.status !== "completed") return;
    if (isImage) {
      // Prefer the local on-device file over the network URL — instant,
      // no signed-URL round-trip, works the same pre/post upload.
      open(item.localUri);
    } else {
      // Non-image file chip: open the canonical download URL in Safari.
      // `downloadUrl` comes from `api.uploadFile(...).download_url`, which
      // on non-CloudFront deployments is a server-relative path like
      // `/api/attachments/{id}/download` (MUL-2976). RN's `Linking.openURL`
      // requires an absolute http(s) URL — `Cannot open URL` otherwise — so
      // resolve against `EXPO_PUBLIC_API_URL` first. Already-absolute
      // CloudFront/presigned URLs pass through unchanged. `null` (no
      // downloadUrl yet) falls through to a no-op.
      const target = resolveAttachmentUrl(item.downloadUrl);
      if (target) void Linking.openURL(target);
    }
  };

  const iconName = item.status === "failed"
    ? "refresh"
    : isImage
      ? "image-outline"
      : "document-outline";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={item.status === "failed" ? "button" : "image"}
      accessibilityLabel={
        item.status === "failed"
          ? t("a11y.retry_upload", { name: item.filename })
          : t("a11y.open_file", { name: item.filename })
      }
      className="flex-row items-center gap-1 h-7 px-2 rounded-full bg-secondary active:opacity-80"
    >
      {item.status === "uploading" ? (
        <ActivityIndicator size="small" color={theme.mutedForeground} />
      ) : (
        <Ionicons
          name={iconName}
          size={12}
          color={
            item.status === "failed"
              ? theme.destructive
              : theme.mutedForeground
          }
        />
      )}
      <Text
        className="text-xs text-foreground max-w-[120px]"
        numberOfLines={1}
      >
        {item.filename}
      </Text>
      <Pressable
        onPress={() => onRemove(item.localId)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("a11y.remove_file", { name: item.filename })}
        className="h-4 w-4 items-center justify-center"
      >
        <Ionicons name="close" size={12} color={theme.mutedForeground} />
      </Pressable>
    </Pressable>
  );
}
