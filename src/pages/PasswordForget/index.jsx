import React, { useContext } from 'react';
import { useIntl } from 'react-intl';
import { useHistory } from 'react-router-dom';
import _ from 'lodash';

import { FormTextInput, Form, Card, Button, Alert } from 'tabler-react';
import { useFormik } from 'formik';
import * as Yup from 'yup';

import * as ROUTES from '../../constants/routes';
import StandaloneFormPage from '../StandaloneFormPage';
import FirebaseBridgeContext from '../../FirebaseBridgeContext';

const PasswordForget = (props) => {
  const firebaseWithBridge = useContext(FirebaseBridgeContext);
  const intl = useIntl();
  const history = useHistory();
  const { match } = props || {};

  const formik = useFormik({
    initialValues: {
      email: match.params.email,
    },
    validationSchema: Yup.object({
      email: Yup.string().email('Invalid email address').required('Required'),
    }),
    onSubmit: (values) => {
      const { email } = values;
      const { auth } = firebaseWithBridge || {};

      auth
        .sendPasswordResetEmail(email)
        .then(() => {
          formik.setStatus(true);
          formik.setSubmitting(false);
        })
        .catch((error) => {
          formik.setErrors({ global: error });
          formik.setSubmitting(false);
        });
    },
  });

  return (
    <StandaloneFormPage>
      <Form className="card" onSubmit={formik.handleSubmit}>
        <Card.Body className="p-6">
          <Card.Title RootComponent="div">
            {intl.formatMessage({ id: 'page.passwordforget.form.title' })}
          </Card.Title>
          <p className="text-muted">
            {intl.formatMessage({
              id: 'page.passwordforget.form.instructions',
            })}
          </p>
          <FormTextInput
            name="email"
            label={intl.formatMessage({
              id: 'page.passwordforget.form.input.email.label',
            })}
            placeholder={intl.formatMessage({
              id: 'page.passwordforget.form.input.email.placeholder',
            })}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            value={formik.values && formik.values.email}
            error={formik.errors && formik.errors.email}
            disabled={formik.isSubmitting || formik.status}
          />
          {formik.errors && formik.errors.global && (
            <Alert type="danger" className="mt-6" isDismissible>
              {formik.errors.global.message}
            </Alert>
          )}
          {formik.status && (
            <Alert type="success" icon="check">
              {intl.formatMessage({ id: 'page.passwordforget.form.success' })}
            </Alert>
          )}
          <Form.Footer>
            <Button
              type="submit"
              color="primary"
              loading={formik.isSubmitting}
              disabled={
                formik.status ||
                formik.isSubmitting ||
                _.isEmpty(formik.values) ||
                !_.isEmpty(formik.errors)
              }
              block
            >
              {intl.formatMessage({ id: 'page.passwordforget.form.button' })}
            </Button>
          </Form.Footer>
          <div className="row row gutters-xs align-items-center mt-5">
            <div className="col col-auto">
              {intl.formatMessage({
                id: 'page.passwordforget.form.signin.label',
              })}
            </div>
            <Button
              link
              className="p-0"
              href="#"
              onClick={() => {
                history.push(ROUTES.SIGN_IN);
              }}
            >
              {intl.formatMessage({
                id: 'page.passwordforget.form.signin.action',
              })}
            </Button>
          </div>
        </Card.Body>
      </Form>
    </StandaloneFormPage>
  );
};

export default PasswordForget;
