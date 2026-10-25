import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Text } from "@/components/ui/text";
import { OtpInput, type OtpInputRef } from "@/components/ui/otp-input";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { AuroLogo } from "@/components/brand/auro-logo";
import { useAuthStore } from "@/data/auth-store";
import { i18n, useT } from "@/lib/i18n";
import { mapAuthError } from "@/lib/auth-error";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

export default function Verify() {
  const sendCode = useAuthStore((s) => s.sendCode);
  const verifyCode = useAuthStore((s) => s.verifyCode);
  const { email = "", setup } = useLocalSearchParams<{ email?: string; setup?: string }>();
  const settingPassword = setup === "signup" || setup === "reset";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);
  const otpRef = useRef<OtpInputRef>(null);
  const { t } = useT("auth");

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const submit = async (value: string) => {
    if (value.length !== CODE_LENGTH || !email || submitting || resending) return;
    if (settingPassword && [...password].length < 8) { setError(t("errors.password_length")); return; }
    if (settingPassword && password !== confirmPassword) { setError(t("errors.password_mismatch")); return; }
    void Haptics.selectionAsync();
    setSubmitting(true);
    setError(null);
    try {
      await verifyCode(email, value, settingPassword ? password : undefined);
      setPassword("");
      setConfirmPassword("");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, t("verify.verify_failed"), (key) => i18n.t(`auth:${key}`)));
      setSubmitting(false);
      otpRef.current?.clear();
      setCode("");
    }
  };

  const onResend = async () => {
    if (cooldown > 0 || resending || submitting || !email) return;
    void Haptics.selectionAsync();
    setResending(true);
    setError(null);
    try {
      await sendCode(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      otpRef.current?.clear();
      setCode("");
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, t("verify.resend_failed"), (key) => i18n.t(`auth:${key}`)));
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerClassName="grow justify-center px-6 py-8 gap-6" keyboardShouldPersistTaps="handled">
          <View className="items-center gap-3">
            <AuroLogo size={32} />
            <View className="gap-1 items-center">
              <Text className="text-2xl font-semibold text-foreground">
                {settingPassword ? t(setup === "signup" ? "password.signup_title" : "password.reset_title") : t("verify.enter_title")}
              </Text>
              <Text className="text-sm text-muted-foreground text-center">
                {t("verify.sent_to", { email })}
              </Text>
            </View>
          </View>

          <View className="gap-3 items-center">
            <OtpInput
              ref={otpRef}
              numberOfDigits={CODE_LENGTH}
              value={code}
              onChange={setCode}
              onComplete={(value) => { if (!settingPassword) void submit(value); }}
              autoFocus
              editable={!submitting && !resending}
            />
            {error ? (
              <Text className="text-sm text-destructive">{error}</Text>
            ) : null}
          </View>

          {settingPassword && <View className="gap-3">
            <Text className="text-sm font-medium">{t("password.new_password")}</Text>
            <TextField accessibilityLabel={t("password.new_password")} secureTextEntry autoComplete="new-password"
              textContentType="newPassword" autoCapitalize="none" autoCorrect={false} value={password}
              onChangeText={setPassword} editable={!submitting} />
            <Text className="text-sm text-muted-foreground">{t("password.hint")}</Text>
            <Text className="text-sm font-medium">{t("password.confirm")}</Text>
            <TextField accessibilityLabel={t("password.confirm")} secureTextEntry autoComplete="new-password"
              textContentType="newPassword" autoCapitalize="none" autoCorrect={false} value={confirmPassword}
              onChangeText={setConfirmPassword} editable={!submitting} returnKeyType="done" onSubmitEditing={() => void submit(code)} />
          </View>}
          <View className="gap-3">
            <Button
              size="lg"
              disabled={submitting || resending || code.length < CODE_LENGTH || (settingPassword && (!password || !confirmPassword))}
              onPress={() => submit(code)}
            >
              <Text>{submitting ? t("verify.verifying") : t("verify.verify")}</Text>
            </Button>

            <Pressable
              onPress={onResend}
              disabled={cooldown > 0 || resending}
              className="py-2 items-center"
            >
              <Text
                className={
                  cooldown > 0 || resending
                    ? "text-sm text-muted-foreground"
                    : "text-sm text-primary"
                }
              >
                {resending
                  ? t("login.sending")
                  : cooldown > 0
                    ? t("verify.resend_in", { count: cooldown })
                    : t("verify.resend")}
              </Text>
            </Pressable>

            <Button
              variant="ghost"
              disabled={submitting}
              onPress={() => router.back()}
            >
              <Text>{t("verify.change_email")}</Text>
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
