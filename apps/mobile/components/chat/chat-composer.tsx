/** Chat draft, attachment, send and stop controls. The parent owns keyboard layout. */
import { useCallback } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { MessageComposer } from "@/components/composer/message-composer";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useT } from "@/lib/i18n";

interface Props {
  /** Current draft text (controlled). Empty string = no draft. */
  value: string;
  /** Fired on every keystroke. The caller writes to the drafts store. */
  onChangeText: (next: string) => void;
  /** Send the serialised markdown content + the completed attachments'
   *  server ids. Caller resets the input by setting `value=""` after a
   *  successful send. */
  onSend: (content: string, attachmentIds: string[]) => Promise<void> | void;
  /** Cancel the in-flight agent task. Only callable while `sending===true`. */
  onStop: () => void;
  /** True while an agent task is running for the active session. The
   *  composer swaps Send for Stop. */
  sending: boolean;
  /** Queued tasks remain busy, but do not expose Stop without draft restore. */
  allowStop?: boolean;
  /** Hard-disable typing + send. Used when there's no usable agent in the
   *  workspace or the session is archived (legacy). */
  disabled?: boolean;
  /** When `disabled`, replaces the pill label with the reason. */
  disabledReason?: string;
}

const IS_IOS = process.env.EXPO_OS === "ios";

export function ChatComposer({
  value,
  onChangeText,
  onSend,
  onStop,
  sending,
  allowStop = true,
  disabled = false,
  disabledReason,
}: Props) {
  const { t } = useT("chat");

  const onSubmit = useCallback(
    async ({
      content,
      attachmentIds,
    }: {
      content: string;
      attachmentIds: string[];
    }) => {
      // `onSend` may be sync or async; await is safe in both cases. If it
      // throws, MessageComposer's catch restores text + chips.
      await onSend(content, attachmentIds);
    },
    [onSend],
  );

  const handleStop = useCallback(() => {
    if (IS_IOS) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onStop();
  }, [onStop]);

  return (
    <MessageComposer
      value={value}
      onChangeText={onChangeText}
      onSubmit={onSubmit}
      placeholder={sending ? t("composer.working") : t("composer.message")}
      pillLabel={
        sending
          ? t("composer.working")
          : disabled
            ? (disabledReason ?? t("composer.unavailable"))
            : t("composer.message")
      }
      pillIcon="chatbubble-ellipses-outline"
      disabled={disabled}
      disabledReason={disabledReason}
      isSending={sending}
      renderStop={allowStop ? () => <StopButton onPress={handleStop} /> : undefined}
      manageKeyboard={false}
    />
  );
}

function StopButton({ onPress }: { onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  const { t } = useT("chat");
  const theme = THEME[colorScheme];
  return (
    <Animated.View
      key="stop"
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(120)}
    >
      <Pressable
        onPress={onPress}
        className="h-8 w-8 items-center justify-center rounded-full bg-foreground active:opacity-80"
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t("composer.stop_agent")}
      >
        <View
          style={{
            width: 10,
            height: 10,
            backgroundColor: theme.background,
            borderRadius: 1.5,
          }}
        />
      </Pressable>
    </Animated.View>
  );
}
