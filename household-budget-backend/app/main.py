from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.core.exceptions import AppException, app_exception_handler
from app.api.v1.router import api_router

app = FastAPI(
    title="EquiBudget Backend API",
    description="Multi-tenant household budgeting with Equal Remaining Amount distribution and sinking funds accrual.",
    version="1.4.0",
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register custom standardized exception handler
app.add_exception_handler(AppException, app_exception_handler)

# Health routes
@app.get("/health")
@app.get("/api/health")
async def root_health():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "auth_mode": settings.AUTH_MODE,
        "environment": settings.ENVIRONMENT,
    }

# Mount API routers
app.include_router(api_router, prefix="/api/v1", tags=["v1"])
app.include_router(api_router, prefix="/api", tags=["api"])
