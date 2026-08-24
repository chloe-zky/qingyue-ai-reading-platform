import logging

from fastapi import APIRouter, Depends, HTTPException
from app.schemas.admin import UpdateLLMConfigRequest
from app.services.admin_service import get_llm_config_status, update_llm_config
from app.services.audit_service import write_audit_log
from app.utils.auth import StaffPrincipal, require_platform_admin

router = APIRouter(prefix="/api/platform/llm-config", tags=["Platform"])
logger = logging.getLogger(__name__)

@router.get("/status")
def api_key_status(
    principal: StaffPrincipal = Depends(require_platform_admin),
):
    try:
        return get_llm_config_status()
    except Exception:
        logger.exception("读取 LLM 配置状态失败")
        raise HTTPException(status_code=500, detail="配置状态读取失败，请稍后重试。")

@router.post("")
def api_update_key(
    req: UpdateLLMConfigRequest,
    principal: StaffPrincipal = Depends(require_platform_admin),
):
    try:
        update_llm_config(
            api_base=req.api_base,
            api_key=req.api_key,
            model_name=req.model_name,
            api_type=req.api_type,
            timeout_seconds=req.timeout_seconds,
            max_retries=req.max_retries,
        )
        write_audit_log(
            principal,
            domain="platform",
            action="llm_config.update",
            resource_type="llm_config",
            summary="更新 AI 服务配置",
            after_data={
                "api_base": req.api_base,
                "model_name": req.model_name,
                "api_type": req.api_type,
                "api_key_changed": bool(req.api_key),
                "timeout_seconds": req.timeout_seconds,
                "max_retries": req.max_retries,
            },
        )
        return {"message": "LLM 配置已安全更新"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        logger.exception("更新 LLM 配置失败")
        raise HTTPException(status_code=500, detail="配置更新失败，请稍后重试。")
