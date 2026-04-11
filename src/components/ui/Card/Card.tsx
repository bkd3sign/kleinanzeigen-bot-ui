import type { ReactNode, ReactElement, HTMLAttributes } from 'react';
import styles from './Card.module.scss';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  children: ReactNode;
}

function CardRoot({ hoverable = false, className, children, ...rest }: CardProps): ReactElement {
  const classes = [styles.card, hoverable && styles.cardHoverable, className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

function CardHeader({ className, children, ...rest }: CardSectionProps): ReactElement {
  const classes = [styles.cardHeader, className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

function CardTitle({ className, children, ...rest }: CardSectionProps): ReactElement {
  const classes = [styles.cardTitle, className].filter(Boolean).join(' ');
  return (
    <h3 className={classes} {...rest}>
      {children}
    </h3>
  );
}

function CardBody({ className, children, ...rest }: CardSectionProps): ReactElement {
  const classes = [styles.cardBody, className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

function CardFooter({ className, children, ...rest }: CardSectionProps): ReactElement {
  const classes = [styles.cardFooter, className].filter(Boolean).join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Body: CardBody,
  Footer: CardFooter,
});
