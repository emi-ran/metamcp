"use client";

import { GoogleWorkspaceScopeType } from "@repo/zod-types";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  FileText,
  KeyRound,
  Mail,
  RefreshCw,
  Settings,
  Table,
  Unlink,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

interface ScopeOption {
  id: GoogleWorkspaceScopeType;
  labelKey: string;
  isWrite: boolean;
  category: "gmail" | "calendar" | "drive" | "docs" | "sheets";
}

const SCOPE_OPTIONS: ScopeOption[] = [
  {
    id: "gmail.readonly",
    labelKey: "googleWorkspaceScopeGmailRead",
    isWrite: false,
    category: "gmail",
  },
  {
    id: "gmail.modify",
    labelKey: "googleWorkspaceScopeGmailModify",
    isWrite: true,
    category: "gmail",
  },
  {
    id: "gmail.compose",
    labelKey: "googleWorkspaceScopeGmailCompose",
    isWrite: true,
    category: "gmail",
  },
  {
    id: "calendar.readonly",
    labelKey: "googleWorkspaceScopeCalendarRead",
    isWrite: false,
    category: "calendar",
  },
  {
    id: "calendar.events",
    labelKey: "googleWorkspaceScopeCalendarEvents",
    isWrite: true,
    category: "calendar",
  },
  {
    id: "drive.readonly",
    labelKey: "googleWorkspaceScopeDriveRead",
    isWrite: false,
    category: "drive",
  },
  {
    id: "drive.file",
    labelKey: "googleWorkspaceScopeDriveFile",
    isWrite: true,
    category: "drive",
  },
  {
    id: "documents.readonly",
    labelKey: "googleWorkspaceScopeDocsRead",
    isWrite: false,
    category: "docs",
  },
  {
    id: "documents",
    labelKey: "googleWorkspaceScopeDocsWrite",
    isWrite: true,
    category: "docs",
  },
  {
    id: "spreadsheets.readonly",
    labelKey: "googleWorkspaceScopeSheetsRead",
    isWrite: false,
    category: "sheets",
  },
  {
    id: "spreadsheets",
    labelKey: "googleWorkspaceScopeSheetsWrite",
    isWrite: true,
    category: "sheets",
  },
];

export function GoogleWorkspaceIntegrationCard() {
  const { t } = useTranslations();
  const [reconnectDialogOpen, setReconnectDialogOpen] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>();
  const [selectedScopes, setSelectedScopes] = useState<GoogleWorkspaceScopeType[]>([
    "gmail.readonly",
    "calendar.readonly",
    "drive.readonly",
    "documents.readonly",
    "spreadsheets.readonly",
  ]);

  // Admin Client Config state
  const [clientIdInput, setClientIdInput] = useState("");
  const [clientSecretInput, setClientSecretInput] = useState("");

  const {
    data: oauthConfig,
    isLoading: oauthConfigLoading,
    refetch: refetchOAuthConfig,
  } = trpc.frontend.googleIntegration.getOAuthConfig.useQuery();

  const setOAuthConfigMutation =
    trpc.frontend.googleIntegration.setOAuthConfig.useMutation({
      onSuccess: () => {
        toast.success(t("settings:googleWorkspaceClientConfigSaved"));
        refetchOAuthConfig();
        setClientSecretInput("");
      },
      onError: (err) => {
        toast.error(t("settings:googleWorkspaceClientConfigError"), {
          description: err.message,
        });
      },
    });

  useEffect(() => {
    if (oauthConfig?.clientId) {
      setClientIdInput(oauthConfig.clientId);
    }
  }, [oauthConfig?.clientId]);

  const {
    data: status,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = trpc.frontend.googleIntegration.getStatus.useQuery();

  const connectMutation = trpc.frontend.googleIntegration.getConnectUrl.useMutation({
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url;
      }
    },
    onError: (err) => {
      toast.error(t("settings:googleWorkspaceConnectError"), {
        description: err.message,
      });
    },
  });

  const reconnectMutation = trpc.frontend.googleIntegration.reconnect.useMutation({
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url;
      }
    },
    onError: (err) => {
      toast.error(t("settings:googleWorkspaceConnectError"), {
        description: err.message,
      });
    },
  });

  const setDefaultMutation = trpc.frontend.googleIntegration.setDefault.useMutation({
    onSuccess: () => refetchStatus(),
    onError: (err) => toast.error(err.message),
  });

  const disconnectMutation = trpc.frontend.googleIntegration.disconnect.useMutation({
    onSuccess: () => {
      toast.success(t("settings:googleWorkspaceDisconnectSuccess"));
      refetchStatus();
    },
    onError: (err) => {
      toast.error(t("settings:googleWorkspaceDisconnectError"), {
        description: err.message,
      });
    },
  });

  const handleConnect = () => {
    connectMutation.mutate();
  };

  const handleReconnect = () => {
    reconnectMutation.mutate({
      connectionId: selectedConnectionId,
      workspaceScopes: selectedScopes,
    });
  };

  const handleScopeToggle = (scopeId: GoogleWorkspaceScopeType, checked: boolean) => {
    if (checked) {
      setSelectedScopes((prev) => [...new Set([...prev, scopeId])]);
    } else {
      setSelectedScopes((prev) => prev.filter((id) => id !== scopeId));
    }
  };

  // Derive connection health state
  const connectionHealth = useMemo(() => {
    if (!status || !status.connected) {
      if (status?.revokedAt) {
        return {
          badge: <Badge variant="destructive">{t("settings:googleWorkspaceRevoked")}</Badge>,
          icon: <AlertCircle className="w-5 h-5 text-destructive" />,
          isRevoked: true,
          isExpired: false,
        };
      }
      return {
        badge: <Badge variant="neutral">{t("settings:googleWorkspaceDisconnected")}</Badge>,
        icon: <Unlink className="w-5 h-5 text-muted-foreground" />,
        isRevoked: false,
        isExpired: false,
      };
    }

    if (status.expiresAt) {
      const expires = new Date(status.expiresAt);
      if (expires.getTime() < Date.now()) {
        return {
          badge: <Badge variant="warning">{t("settings:googleWorkspaceExpired")}</Badge>,
          icon: <AlertTriangle className="w-5 h-5 text-amber-500" />,
          isRevoked: false,
          isExpired: true,
        };
      }
    }

    return {
      badge: <Badge variant="success">{t("settings:googleWorkspaceConnected")}</Badge>,
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
      isRevoked: false,
      isExpired: false,
    };
  }, [status, t]);

  const grantedScopeSummary = useMemo(() => {
    if (!status?.scopes || status.scopes.length === 0) return [];
    return status.scopes.map((s) => {
      const cleaned = s.replace("https://www.googleapis.com/auth/", "");
      return cleaned;
    });
  }, [status?.scopes]);

  return (
    <div className="space-y-6">
      {/* Admin OAuth Client Configuration Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl">
                  {t("settings:googleWorkspaceClientConfigTitle")}
                </CardTitle>
                {oauthConfig?.configured ? (
                  <Badge variant="success">
                    {t("settings:googleWorkspaceConfigured")}
                  </Badge>
                ) : (
                  <Badge variant="neutral">
                    {t("settings:googleWorkspaceNotConfigured")}
                  </Badge>
                )}
              </div>
              <CardDescription>
                {t("settings:googleWorkspaceClientConfigDescription")}
              </CardDescription>
            </div>
            <div>
              <Settings className="w-5 h-5 text-muted-foreground" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {oauthConfigLoading ? (
            <div className="text-sm text-muted-foreground">
              {t("settings:loading")}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="google-client-id">
                  {t("settings:googleWorkspaceClientId")}
                </Label>
                <Input
                  id="google-client-id"
                  placeholder={t("settings:googleWorkspaceClientIdPlaceholder")}
                  value={clientIdInput}
                  onChange={(e) => setClientIdInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="google-client-secret">
                  {t("settings:googleWorkspaceClientSecret")}
                </Label>
                <Input
                  id="google-client-secret"
                  type="password"
                  placeholder={
                    oauthConfig?.clientSecretMasked
                      ? `${oauthConfig.clientSecretMasked} (Enter new value to update)`
                      : t("settings:googleWorkspaceClientSecretPlaceholder")
                  }
                  value={clientSecretInput}
                  onChange={(e) => setClientSecretInput(e.target.value)}
                />
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end border-t pt-4">
          <Button
            size="sm"
            disabled={
              setOAuthConfigMutation.isPending ||
              !clientIdInput.trim() ||
              (!clientSecretInput.trim() && !oauthConfig?.configured)
            }
            onClick={() => {
              if (clientIdInput.trim()) {
                setOAuthConfigMutation.mutate({
                  clientId: clientIdInput.trim(),
                  clientSecret: clientSecretInput.trim(),
                });
              }
            }}
          >
            {setOAuthConfigMutation.isPending
              ? t("settings:googleWorkspaceSavingClientConfig")
              : t("settings:googleWorkspaceSaveClientConfig")}
          </Button>
        </CardFooter>
      </Card>

      {/* User Connection & Permissions Card */}
      <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-xl">{t("settings:googleWorkspace")}</CardTitle>
              {connectionHealth.badge}
            </div>
            <CardDescription>
              {t("settings:googleWorkspaceDescription")}
            </CardDescription>
          </div>
          <div>{connectionHealth.icon}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusLoading ? (
          <div className="text-sm text-muted-foreground">{t("settings:loading")}</div>
        ) : status?.connected ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {status.connections.map((connection) => (
                <div key={connection.id} className="flex items-center justify-between rounded border p-3 text-sm">
                  <span>{connection.maskedEmail || "Connected account"}</span>
                  <div className="flex items-center gap-2">
                    {connection.isDefault ? <Badge variant="secondary">Default</Badge> : (
                      <Button size="sm" variant="ghost" onClick={() => setDefaultMutation.mutate({ connectionId: connection.id })}>
                        Set default
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => { setSelectedConnectionId(connection.id); setReconnectDialogOpen(true); }}>
                      Reconnect
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={disconnectMutation.isPending}
                      onClick={() => disconnectMutation.mutate({ connectionId: connection.id })}
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm bg-muted/40 p-4 rounded-lg">
              <div>
                <span className="text-muted-foreground block">
                  {t("settings:googleWorkspaceAccount")}
                </span>
                <span className="font-medium">
                  {status.maskedEmail || "Connected (Hidden/Masked)"}
                </span>
              </div>
              {status.expiresAt && (
                <div>
                  <span className="text-muted-foreground block">
                    {t("settings:googleWorkspaceExpiresAt")}
                  </span>
                  <span className="font-medium">
                    {new Date(status.expiresAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("settings:googleWorkspaceGrantedScopes")}
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {grantedScopeSummary.length > 0 ? (
                  grantedScopeSummary.map((scope) => (
                    <Badge key={scope} variant="outline" className="text-xs">
                      {scope}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t("settings:googleWorkspaceNoScopes")}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {!oauthConfig?.configured ? (
              <span className="text-amber-500 font-medium">
                {t("settings:googleWorkspaceConfigRequiredWarning")}
              </span>
            ) : connectionHealth.isRevoked ? (
              t("settings:googleWorkspaceRevoked")
            ) : (
              t("settings:googleWorkspaceDisconnected")
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 justify-between border-t pt-4">
        <div className="flex items-center gap-2">
          {status?.connected ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={disconnectMutation.isPending}
                >
                  <Unlink className="w-4 h-4 mr-2" />
                  {disconnectMutation.isPending
                    ? t("settings:googleWorkspaceDisconnecting")
                    : t("settings:googleWorkspaceDisconnect")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("settings:googleWorkspaceDisconnect")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("settings:googleWorkspaceDisconnectConfirm")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("settings:cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => disconnectMutation.mutate()}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    {t("settings:googleWorkspaceDisconnect")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={handleConnect}
              disabled={connectMutation.isPending || !oauthConfig?.configured}
            >
              <KeyRound className="w-4 h-4 mr-2" />
              {connectMutation.isPending
                ? t("settings:googleWorkspaceConnecting")
                : t("settings:googleWorkspaceConnect")}
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Dialog open={reconnectDialogOpen} onOpenChange={setReconnectDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={reconnectMutation.isPending}
                onClick={() => setSelectedConnectionId(status?.defaultConnectionId ?? undefined)}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {t("settings:googleWorkspaceReconnect")}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{t("settings:googleWorkspaceSelectScopes")}</DialogTitle>
                <DialogDescription>
                  {t("settings:googleWorkspaceSelectScopesDescription")}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
                <div className="space-y-3">
                  {SCOPE_OPTIONS.map((opt) => (
                    <div
                      key={opt.id}
                      className="flex items-start space-x-3 p-2 rounded-md border hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        id={`scope-${opt.id}`}
                        checked={selectedScopes.includes(opt.id)}
                        onCheckedChange={(checked) =>
                          handleScopeToggle(opt.id, checked === true)
                        }
                        className="mt-1"
                      />
                      <div className="grid gap-1">
                        <Label
                          htmlFor={`scope-${opt.id}`}
                          className="text-sm font-medium cursor-pointer flex items-center gap-2"
                        >
                          {opt.category === "gmail" && <Mail className="w-4 h-4 text-blue-500" />}
                          {opt.category === "calendar" && <Calendar className="w-4 h-4 text-emerald-500" />}
                          {opt.category === "drive" && <KeyRound className="w-4 h-4 text-amber-500" />}
                          {opt.category === "docs" && <FileText className="w-4 h-4 text-sky-500" />}
                          {opt.category === "sheets" && <Table className="w-4 h-4 text-green-600" />}
                          <span>{t(`settings:${opt.labelKey}`)}</span>
                          {opt.isWrite && (
                            <Badge variant="warning" className="text-[10px] px-1 py-0">
                              Write
                            </Badge>
                          )}
                        </Label>
                        <p className="text-xs text-muted-foreground">{opt.id}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setReconnectDialogOpen(false)}
                >
                  {t("settings:cancel")}
                </Button>
                <Button
                  onClick={handleReconnect}
                  disabled={reconnectMutation.isPending}
                >
                  {reconnectMutation.isPending
                    ? t("settings:googleWorkspaceConnecting")
                    : t("settings:googleWorkspaceReconnect")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardFooter>
    </Card>
    </div>
  );
}
