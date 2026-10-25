import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { AuroLogo } from "@/components/brand/auro-logo";
import { useAuthStore } from "@/data/auth-store";
import { i18n, useT } from "@/lib/i18n";
import { mapAuthError } from "@/lib/auth-error";

export default function Login() {
  const { t } = useT("auth");
  const loginWithPassword = useAuthStore((s) => s.loginWithPassword);
  const [mode, setMode] = useState<"password" | "code">("password");
  const [password, setPassword] = useState("");
  const sendCode = useAuthStore((s) => s.sendCode);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (setup?: "signup" | "reset") => {
    const trimmed = email.trim();
    if (!trimmed || submitting) return;
    void Haptics.selectionAsync();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "password" && !setup) {
        await loginWithPassword(trimmed, password);
        setPassword("");
        router.replace("/");
      } else {
        await sendCode(trimmed);
        router.push({ pathname: "/verify", params: { email: trimmed, ...(setup ? { setup } : {}) } });
      }
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, t(mode === "password" && !setup ? "errors.login_failed" : "login.send_failed"), (key) => i18n.t(`auth:${key}`)));
    } finally {
      setSubmitting(false);
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
                {t("login.title")}
              </Text>
              {mode === "code" && <Text className="text-sm text-muted-foreground text-center">{t("login.subtitle")}</Text>}
            </View>
          </View>

          <View className="gap-3">
            <Text nativeID="login-email" className="text-sm font-medium">{t("login.email_label")}</Text>
            <TextField
              accessibilityLabel={t("login.email_label")}
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
              keyboardType="email-address"
              placeholder={t("login.email_placeholder")}
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={() => { if (mode === "code") void onSubmit(); }}
              returnKeyType="send"
              editable={!submitting}
              invalid={!!error}
            />
            {mode === "password" && <>
              <Text nativeID="login-password" className="text-sm font-medium">{t("password.label")}</Text>
              <TextField accessibilityLabel={t("password.label")} secureTextEntry
                autoCapitalize="none" autoCorrect={false} autoComplete="current-password"
                textContentType="password" value={password} onChangeText={setPassword}
                editable={!submitting} returnKeyType="go" onSubmitEditing={() => void onSubmit()} />
            </>}
            {error ? (
              <Text className="text-sm text-destructive">{error}</Text>
            ) : null}
          </View>

          <Button
            size="lg"
            disabled={submitting || !email.trim() || (mode === "password" && !password)}
            onPress={() => void onSubmit()}
          >
            <Text>{mode === "password" ? (submitting ? t("password.signing_in") : t("password.sign_in")) : (submitting ? t("login.sending") : t("login.send_code"))}</Text>
          </Button>
          <View className="gap-1">
            {mode === "password" && <Button variant="ghost" disabled={submitting || !email.trim()} onPress={() => void onSubmit("reset")}>
              <Text>{t("password.forgot")}</Text>
            </Button>}
            <Button variant="ghost" disabled={submitting} onPress={() => { setMode(mode === "password" ? "code" : "password"); setPassword(""); setError(null); }}>
              <Text>{mode === "password" ? t("password.use_code") : t("password.use_password")}</Text>
            </Button>
            <Button variant="ghost" disabled={submitting || !email.trim()} onPress={() => void onSubmit("signup")}>
              <Text>{t("password.signup")}</Text>
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
