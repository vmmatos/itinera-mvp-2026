import { createLogger } from '@itinera/shared'
import sgMail from '@sendgrid/mail'
import nodemailer from 'nodemailer'
import type { Config } from '@/config'
import type { RenderedEmail } from '@/templates'

export interface EmailTransport {
  send(
    to: string,
    from: { email: string; name: string },
    rendered: RenderedEmail,
  ): Promise<void>
}

export function createEmailTransport(config: Config): EmailTransport {
  const logger = createLogger('notification')

  if (config.SENDGRID_ENABLED) {
    if (!config.SENDGRID_API_KEY) {
      throw new Error('SENDGRID_API_KEY must be set when SENDGRID_ENABLED=true')
    }
    sgMail.setApiKey(config.SENDGRID_API_KEY)

    return {
      async send(to, from, rendered): Promise<void> {
        await sgMail.send({
          to,
          from: { email: from.email, name: from.name },
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        })
        logger.info('Email sent via SendGrid', { to, subject: rendered.subject })
      },
    }
  }

  const transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: false,
    ignoreTLS: true,
  })

  return {
    async send(to, from, rendered): Promise<void> {
      await transporter.sendMail({
        to,
        from: `"${from.name}" <${from.email}>`,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      })
      logger.info('Email sent via SMTP', {
        to,
        subject: rendered.subject,
        host: config.SMTP_HOST,
      })
    },
  }
}
