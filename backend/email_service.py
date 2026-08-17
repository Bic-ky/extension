"""
Email service for sending verification links via SMTP.
Uses environment variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, APP_URL
"""

import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

logger = logging.getLogger("uvicorn.error")

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
APP_URL = os.getenv("APP_URL", "http://127.0.0.1:8000")


def send_verification_email(to_email: str, full_name: str, token: str) -> bool:
    """
    Send an email with a verification link.
    Returns True on success, False on failure (logs the error).
    """
    verification_url = f"{APP_URL}/api/auth/verify?token={token}"

    subject = "Fleet Exporter — Verify Your Email"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <body style="font-family: 'Inter', Arial, sans-serif; background-color: #f8f9fa; margin: 0; padding: 40px 20px;">
      <div style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e9ecef; overflow: hidden;">
        <div style="background: #343a40; color: #ffffff; padding: 24px 30px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px; font-weight: 600;">Fleet Exporter</h1>
          <p style="margin: 6px 0 0 0; font-size: 13px; opacity: 0.8;">Email Verification</p>
        </div>
        <div style="padding: 30px;">
          <p style="font-size: 14px; color: #212529; line-height: 1.6; margin: 0 0 20px 0;">
            Hi <strong>{full_name}</strong>,
          </p>
          <p style="font-size: 14px; color: #212529; line-height: 1.6; margin: 0 0 24px 0;">
            Your account has been created on Fleet Exporter. Please click the button below to verify your email address and activate your account.
          </p>
          <div style="text-align: center; margin: 0 0 24px 0;">
            <a href="{verification_url}"
               style="display: inline-block; background: #343a40; color: #ffffff; text-decoration: none;
                      padding: 12px 32px; border-radius: 6px; font-size: 14px; font-weight: 500;">
              Verify Email
            </a>
          </div>
          <p style="font-size: 12px; color: #6c757d; line-height: 1.5; margin: 0;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="{verification_url}" style="color: #343a40; word-break: break-all;">{verification_url}</a>
          </p>
        </div>
        <div style="background: #f8f9fa; border-top: 1px solid #e9ecef; padding: 16px 30px; text-align: center;">
          <p style="font-size: 11px; color: #6c757d; margin: 0;">
            This is an automated message from Fleet Exporter. Do not reply.
          </p>
        </div>
      </div>
    </body>
    </html>
    """

    if not SMTP_USER or not SMTP_PASS:
        logger.warning(f"SMTP not configured. Verification email for {to_email} was not sent.")
        return True

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"Fleet Exporter <{SMTP_USER}>"
        msg["To"] = to_email

        # Plain-text fallback
        plain_text = (
            f"Hi {full_name},\n\n"
            f"Your account has been created. Verify your email by visiting:\n"
            f"{verification_url}\n\n"
            f"— Fleet Exporter"
        )
        msg.attach(MIMEText(plain_text, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, to_email, msg.as_string())

        logger.info(f"Verification email sent to {to_email}")
        return True

    except Exception as e:
        logger.error(f"Failed to send verification email to {to_email}")
        return False
