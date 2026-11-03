/** Chat message composer with attachments and pending sends. */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Alert, Keyboard, Pressable, TextInput, View } from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { api, MAX_FILE_SIZE } from "@/data/api";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { continuousCorners } from "@/lib/radius";
import { Text } from "@/components/ui/text";
import { IconButton } from "@/components/ui/icon-button";
import { ComposerAttachmentRow, type ComposerAttachmentItem } from "@/components/composer/composer-attachment-row";
import { useT } from "@/lib/i18n";

interface Props {
  /** Submit callback. Composer awaits this; on rejection it restores text,
   *  attachments so the user can retry without losing
   *  context. Resolved promise → text + chips cleared, composer collapses
   *  back to pill. */
  onSubmit: (args: {
    content: string;
    attachmentIds: string[];
  }) => Promise<void>;

  /** Optional chat session to bind uploaded attachments before sending. */
  uploadContext?: { chatSessionId?: string };

  placeholder?: string;
  pillLabel?: string;
  pillIcon?: keyof typeof Ionicons.glyphMap;

  /** Optional controlled-text mode. When `value` + `onChangeText` are
   *  both provided, the parent owns the draft (chat: persists to its
   *  draft store across sessions). When omitted, composer manages its
   *  own internal text state. */
  value?: string;
  onChangeText?: (next: string) => void;

  /** When `isSending` is true AND `renderStop` is provided, the trailing
   *  send button is replaced by whatever `renderStop` returns. Chat uses
   *  this to show a Stop affordance while the agent is running. */
  isSending?: boolean;
  renderStop?: () => ReactNode;

  /** Hard-disable. Used when chat has no usable agent. The pill shows
   *  `disabledReason` instead of `pillLabel`, and the pill is
   *  non-interactive (cannot expand). */
  disabled?: boolean;
  disabledReason?: string;

  /** When true the composer renders flush at the bottom of its parent
   *  WITHOUT the KeyboardStickyView keyboard-aware lift + safe-area
   *  inset. Chat's parent owns its own KeyboardAvoidingView and
   *  bottom-inset handling (chat.tsx), so the composer must not also
   *  apply them. */
  manageKeyboard?: boolean;
}

function makeLocalId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MessageComposer({
  onSubmit,
  uploadContext,
  placeholder,
  pillLabel,
  pillIcon = "chatbubble-ellipses-outline",
  value: controlledValue,
  onChangeText: controlledOnChange,
  isSending = false,
  renderStop,
  disabled = false,
  disabledReason,
  manageKeyboard = true,
}: Props) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const { t } = useT("chat");
  const resolvedPlaceholder = placeholder ?? t("composer.default_placeholder");
  const resolvedPillLabel = pillLabel ?? t("composer.default_placeholder");
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const [expanded, setExpanded] = useState(false);
  const [internalText, setInternalText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachmentItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Controlled drafts persist across chat sessions; other callers use local state.
  const isControlled =
    controlledValue !== undefined && controlledOnChange !== undefined;
  const text = isControlled ? controlledValue : internalText;
  const setText = useCallback(
    (next: string) => {
      if (isControlled) {
        controlledOnChange(next);
      } else {
        setInternalText(next);
      }
    },
    [isControlled, controlledOnChange],
  );

  const hasInFlightUpload = attachments.some((a) => a.status === "uploading");
  const canSend =
    !disabled &&
    !isSending &&
    !submitting &&
    !hasInFlightUpload &&
    (text.trim().length > 0);

  const expand = useCallback(() => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExpanded(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled]);

  const handleSubmit = useCallback(async () => {
    if (!canSend) return;
    const textSnap = text;
    const attachmentsSnap = attachments;
    const content = textSnap.trim();

    const activeIds = attachmentsSnap
      .filter((a) => a.status === "completed")
      .map((a) => a.id)
      .filter((id): id is string => !!id);

    // Optimistic clear: text + chips empty out immediately so the next
    // typing tick doesn't double-include them. Restored on rejection.
    setText("");
    setAttachments([]);
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    try {
      await onSubmit({
        content,
        attachmentIds: activeIds,
      });
      // Success → fully exit composing mode. Explicit triple-step
      // because a missing blur leaves the keyboard up; missing
      // Keyboard.dismiss races on iOS when focus is in-flight; missing
      // setExpanded(false) leaves the expanded card on screen.
      inputRef.current?.blur();
      Keyboard.dismiss();
      setExpanded(false);
    } catch {
      setText(textSnap);
      setAttachments(attachmentsSnap);
    } finally {
      setSubmitting(false);
    }
  }, [
    canSend,
    text,
    attachments,
    setText,
    onSubmit,
  ]);

  /** Streams a picked asset to /api/upload-file, updating the matching
   *  thumbnail's status as it goes. Pulled out so retry can call it
   *  again without re-opening the picker. */
  const startUpload = useCallback(
    async (
      localId: string,
      asset: { uri: string; name: string; type: string },
    ) => {
      try {
        const result = await api.uploadFile(asset, uploadContext);
        setAttachments((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? {
                  ...it,
                  status: "completed",
                  id: result.id,
                  url: result.url,
                  downloadUrl: result.download_url,
                }
              : it,
          ),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t("common:states.error");
        setAttachments((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? { ...it, status: "failed", error: message }
              : it,
          ),
        );
      }
    },
    [uploadContext, t],
  );

  const onImagePress = useCallback(async () => {
    const picker = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (picker.canceled) return;
    const picked = picker.assets[0];
    if (!picked) return;
    if (picked.fileSize != null && picked.fileSize > MAX_FILE_SIZE) {
      Alert.alert(
        t("composer.file_too_large_title"),
        t("composer.file_too_large_message"),
      );
      return;
    }
    const filename = picked.fileName ?? `image-${Date.now()}.jpg`;
    const mimeType = picked.mimeType ?? "image/jpeg";
    const localId = makeLocalId();
    setAttachments((prev) => [
      ...prev,
      {
        localId,
        localUri: picked.uri,
        filename,
        mimeType,
        status: "uploading",
      },
    ]);
    requestAnimationFrame(() => inputRef.current?.focus());
    await startUpload(localId, {
      uri: picked.uri,
      name: filename,
      type: mimeType,
    });
  }, [startUpload, t]);

  const onFilePress = useCallback(async () => {
    const picker = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picker.canceled) return;
    const picked = picker.assets[0];
    if (!picked) return;
    if (picked.size != null && picked.size > MAX_FILE_SIZE) {
      Alert.alert(
        t("composer.file_too_large_title"),
        t("composer.file_too_large_message"),
      );
      return;
    }
    const mimeType = picked.mimeType ?? "application/octet-stream";
    const localId = makeLocalId();
    setAttachments((prev) => [
      ...prev,
      {
        localId,
        localUri: picked.uri,
        filename: picked.name,
        mimeType,
        status: "uploading",
      },
    ]);
    requestAnimationFrame(() => inputRef.current?.focus());
    await startUpload(localId, {
      uri: picked.uri,
      name: picked.name,
      type: mimeType,
    });
  }, [startUpload, t]);

  const onRemoveAttachment = useCallback((localId: string) => {
    setAttachments((prev) => prev.filter((it) => it.localId !== localId));
  }, []);

  const onRetryAttachment = useCallback(
    (localId: string) => {
      const item = attachments.find((it) => it.localId === localId);
      if (!item) return;
      setAttachments((prev) =>
        prev.map((it) =>
          it.localId === localId
            ? { ...it, status: "uploading", error: undefined }
            : it,
        ),
      );
      void startUpload(localId, {
        uri: item.localUri,
        name: item.filename,
        type: item.mimeType,
      });
    },
    [attachments, startUpload],
  );

  /** Auto-collapse to pill when input loses focus AND nothing's worth
   *  keeping the composer expanded for. Deferred one tick so a toolbar
   *  IconButton tap (which briefly resigns first responder) doesn't
   *  trigger a collapse before its onPress runs. */
  const onBlur = useCallback(() => {
    setTimeout(() => {
      const empty =
        text.trim().length === 0 &&
        attachments.length === 0;
      if (empty && !inputRef.current?.isFocused()) {
        setExpanded(false);
      }
    }, 80);
  }, [text, attachments.length]);

  const pillContent = (
    <View
      className="border-t border-border bg-background px-3 pt-2"
      style={{ paddingBottom: (manageKeyboard ? insets.bottom : 0) + 8 }}
    >
      <Pressable
        onPress={expand}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={pillLabel}
        accessibilityState={{ disabled }}
        className="flex-row items-center gap-2 h-11 px-4 rounded-full bg-secondary active:opacity-80"
      >
        <Ionicons
          name={pillIcon}
          size={18}
          color={theme.mutedForeground}
        />
        <Text className="text-base text-muted-foreground">
          {disabled && disabledReason ? disabledReason : resolvedPillLabel}
        </Text>
      </Pressable>
    </View>
  );

  const expandedContent = (
    <View
      className="bg-background px-3 pt-2 gap-2"
      style={{ paddingBottom: (manageKeyboard ? insets.bottom : 0) + 4 }}
    >

      <View
        className="rounded-2xl border border-border bg-secondary"
        style={continuousCorners}
      >
        {(attachments.length > 0) ? (
          <View className="px-2 pt-2 pb-1">
            <ComposerAttachmentRow
              attachments={attachments}
              onRemoveAttachment={onRemoveAttachment}
              onRetryAttachment={onRetryAttachment}
            />
          </View>
        ) : null}

        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          onBlur={onBlur}
          placeholder={resolvedPlaceholder}
          placeholderTextColor={theme.mutedForeground}
          multiline
          editable={!disabled}
          className="px-4 pt-3 pb-1 text-base text-foreground"
          style={{ minHeight: 28, maxHeight: 140, textAlignVertical: "top" }}
        />

        <View className="flex-row items-center px-2 pb-2 pt-1">
          {/* @ leads the toolbar — highest-signal attachment (only one
           *  that drives notifications) and cross-resource (people +
           *  issues), pride-of-place left. */}
          
          <IconButton
            name="image-outline"
            iconSize={20}
            onPress={onImagePress}
            accessibilityLabel={t("composer.upload_image")}
            className="h-8 w-8"
          />
          <IconButton
            name="attach-outline"
            iconSize={20}
            onPress={onFilePress}
            accessibilityLabel={t("composer.upload_file")}
            className="h-8 w-8"
          />
          <View className="flex-1" />
          {isSending && renderStop ? (
            renderStop()
          ) : (
            <IconButton
              name="arrow-up"
              iconSize={18}
              color={theme.primaryForeground}
              variant="default"
              onPress={handleSubmit}
              disabled={!canSend}
              hitSlop={12}
              className="h-8 w-8 rounded-full"
              accessibilityLabel={t("composer.send")}
              accessibilityState={{ disabled: !canSend }}
            />
          )}
        </View>
      </View>
    </View>
  );

  const body = expanded ? expandedContent : pillContent;

  // When the parent owns keyboard handling (chat.tsx wraps in
  // KeyboardAvoidingView + SafeAreaView), skip the KeyboardStickyView —
  // double-stacking causes the composer to jump twice on keyboard show.
  if (!manageKeyboard) return body;

  return (
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
      {body}
    </KeyboardStickyView>
  );
}
