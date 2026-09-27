import { checkLogin, sessionCookie, clearCookie } from '../lib/common.js'

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query.logout !== undefined) {
    res.setHeader('Set-Cookie', clearCookie)
    return res.redirect(303, '../')
  }
  if (req.method !== 'POST') return res.status(405).end()

  const { user = '', pass = '' } = req.body || {}
  if (!checkLogin(String(user).trim(), String(pass))) {
    await new Promise(r => setTimeout(r, 800)) // slow down guessing
    return res.redirect(303, '../?err=1')
  }
  res.setHeader('Set-Cookie', sessionCookie(String(user).trim()))
  res.redirect(303, '../')
}
