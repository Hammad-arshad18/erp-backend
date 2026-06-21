const { Resend } = require("resend");

function f2(x) {
  return Number(x || 0).toFixed(2);
}

// Mirrors _build_invoice_html in server.py
function buildInvoiceHtml(inv, payUrl = null) {
  let rows = "";
  for (const it of inv.items || []) {
    rows += `<tr>
          <td style='padding:8px 0;border-bottom:1px solid #e7e5e4;color:#1c1917'>${it.name}</td>
          <td style='padding:8px 0;border-bottom:1px solid #e7e5e4;text-align:right;color:#1c1917'>${it.qty}</td>
          <td style='padding:8px 0;border-bottom:1px solid #e7e5e4;text-align:right;color:#1c1917'>$${f2(it.price)}</td>
          <td style='padding:8px 0;border-bottom:1px solid #e7e5e4;text-align:right;color:#1c1917'>$${f2(it.line_total)}</td>
        </tr>`;
  }
  let payButton = "";
  if (payUrl) {
    payButton = `
        <tr><td style='padding-top:20px'>
          <a href='${payUrl}' style='display:inline-block;background:#14532D;color:#ffffff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:600'>Pay online</a>
        </td></tr>`;
  }
  const createdAt = String(inv.created_at || "").slice(0, 19).replace("T", " ");
  return `<!doctype html><html><body style='margin:0;padding:32px;background:#f9f8f6;font-family:Arial,sans-serif'>
      <table style='max-width:560px;margin:auto;background:white;border-radius:16px;padding:32px;border:1px solid #e7e5e4' cellspacing='0' cellpadding='0'>
        <tr><td>
          <h1 style='margin:0 0 4px 0;font-size:24px;color:#14532D'>Vyntrio ERP</h1>
          <p style='margin:0 0 24px 0;color:#78716c;font-size:13px'>Invoice ${inv.invoice_number || ""}</p>
          <p style='margin:0 0 4px 0;color:#1c1917'><strong>${inv.customer_name || "Walk-in"}</strong></p>
          <p style='margin:0 0 20px 0;color:#78716c;font-size:13px'>${createdAt}</p>
          <table width='100%' cellspacing='0' cellpadding='0'>
            <tr>
              <th style='text-align:left;font-size:11px;color:#78716c;letter-spacing:.05em;text-transform:uppercase;padding:8px 0;border-bottom:2px solid #14532D'>Item</th>
              <th style='text-align:right;font-size:11px;color:#78716c;letter-spacing:.05em;text-transform:uppercase;padding:8px 0;border-bottom:2px solid #14532D'>Qty</th>
              <th style='text-align:right;font-size:11px;color:#78716c;letter-spacing:.05em;text-transform:uppercase;padding:8px 0;border-bottom:2px solid #14532D'>Price</th>
              <th style='text-align:right;font-size:11px;color:#78716c;letter-spacing:.05em;text-transform:uppercase;padding:8px 0;border-bottom:2px solid #14532D'>Total</th>
            </tr>
            ${rows}
          </table>
          <table width='100%' style='margin-top:20px' cellspacing='0' cellpadding='0'>
            <tr><td style='color:#57534e'>Subtotal</td><td style='text-align:right;color:#1c1917'>$${f2(inv.subtotal)}</td></tr>
            <tr><td style='color:#57534e'>Tax</td><td style='text-align:right;color:#1c1917'>$${f2(inv.tax_amount)}</td></tr>
            <tr><td style='color:#57534e'>Discount</td><td style='text-align:right;color:#1c1917'>-$${f2(inv.discount)}</td></tr>
            <tr><td style='padding-top:8px;border-top:2px solid #14532D;font-weight:700;color:#14532D'>Total</td>
                <td style='padding-top:8px;border-top:2px solid #14532D;text-align:right;font-weight:700;color:#14532D'>$${f2(inv.total)}</td></tr>
            ${payButton}
          </table>
          <p style='margin-top:32px;color:#a8a29e;font-size:11px;text-align:center'>Thank you for doing business with Vyntrio ERP. Loyalty points earned: <strong>${inv.points_earned || 0}</strong></p>
        </td></tr>
      </table>
    </body></html>`;
}

async function sendEmail(apiKey, params) {
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send(params);
  if (error) {
    throw new Error(error.message || JSON.stringify(error));
  }
  return data;
}

module.exports = { buildInvoiceHtml, sendEmail };
