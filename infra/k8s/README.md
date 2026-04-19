# Kubernetes Manifests (stub)

Este diretório receberá os manifestos de staging/produção: Deployments, Services, Ingress, HPA, NetworkPolicies, ConfigMaps e Secrets (via ExternalSecrets ou Sealed Secrets).

**Próximos passos antes de ir para produção:**

1. Definir IaC (sugestão: Terraform para AWS EKS / GKE / AKS)
2. Helm charts por app (`api-gateway`, `core-service`, `web`)
3. Ingress (nginx-ingress ou Traefik) com cert-manager
4. Observabilidade (kube-prometheus-stack + Loki + Tempo)
5. Backup (Velero + snapshots de RDS/CloudSQL)
6. Runbook de disaster recovery

Mantido como stub intencionalmente enquanto o MVP roda via Docker Compose.
